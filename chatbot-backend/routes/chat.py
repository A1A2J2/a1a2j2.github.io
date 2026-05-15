from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from database import get_db, User, Usage, Message, Conversation, Memory
from models import ChatRequest, ConversationRename
from middleware.auth import get_current_user
from services.ollama_service import generate_response
from services.web_service import enhance_with_internet
from datetime import datetime, date, timedelta
import asyncio
import json

router = APIRouter()

MODEL_GROUPS = {
    "llama2_7b": "7b",
    "qwen2_7b": "7b",
    "phi": "7b",
    "llama2_13b": "13b",
    "llama3_8b": "8b",
    "qwen code 3 8b": "8b",
    "qwen 3:8b": "8b"
}

LIMITS = {
    "free": {"7b": 100, "8b": 100, "13b": 5},
    "paid": {"7b": float('inf'), "8b": float('inf'), "13b": 25},
    "admin": {"7b": float('inf'), "8b": float('inf'), "13b": float('inf')}
}

async def extract_memory(user_id: int, message: str, db: Session):
    # Background task to extract memory
    prompt = f"Extract any key facts about the user from the following message. If there are no key facts, respond with exactly 'NONE'. Message: '{message}'"
    res = await generate_response("phi", [{"role": "user", "content": prompt}])
    if "error" not in res:
        fact = res.get("response", "").strip()
        if fact and "NONE" not in fact.upper() and len(fact) > 5:
            # save memory
            mem = Memory(user_id=user_id, content=fact)
            db.add(mem)
            db.commit()

async def generate_title(conversation_id: int, message: str, db: Session):
    prompt = f"Summarize the following message into a very short conversation title (max 5 words). Message: '{message}'"
    res = await generate_response("phi", [{"role": "user", "content": prompt}])
    if "error" not in res:
        title = res.get("response", "").strip().strip('"').strip("'")
        if title:
            conv = db.query(Conversation).filter(Conversation.conversation_id == conversation_id).first()
            if conv:
                conv.title = title
                db.commit()

@router.post("/send")
async def send_message(request: ChatRequest, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    if request.model_id not in MODEL_GROUPS:
        raise HTTPException(status_code=400, detail="Invalid model ID")
    
    user_id = current_user["user_id"]
    tier = current_user["tier"]
    group = MODEL_GROUPS[request.model_id]
    
    # Check usage
    usage = db.query(Usage).filter(Usage.user_id == user_id).first()
    if not usage:
        raise HTTPException(status_code=400, detail="Usage record not found")
    
    # Check if reset needed
    if (date.today() - usage.month_start_date).days >= 30:
        usage.month_start_date = date.today()
        usage.model_7b_uses = 0
        usage.model_8b_uses = 0
        usage.model_13b_uses = 0
        db.commit()
    
    current_uses = getattr(usage, f"model_{group}_uses")
    limit = LIMITS[tier][group]
    
    if current_uses >= limit:
        raise HTTPException(status_code=429, detail="Monthly limit reached for this model tier")

    # Calling Ollama
    ollama_model = request.model_id.replace("_", ":")
    
    # Enhance message with internet context if needed or if web_search flag is True
    msg_to_enhance = request.message
    if getattr(request, 'web_search', False):
        msg_to_enhance = f"Search the web for: {request.message}"
    enhanced_msg = await enhance_with_internet(msg_to_enhance)
    if getattr(request, 'web_search', False) and msg_to_enhance == enhanced_msg:
        # If web search was requested but didn't trigger, force it
        from services.web_service import search_web
        search_res = await search_web(request.message)
        if search_res:
            enhanced_msg = f"{search_res}\n\nUser Message: {request.message}"

    # Determine conversation_id
    conv_id = request.conversation_id
    is_new_conversation = False
    if not conv_id:
        conv = Conversation(user_id=user_id, title=request.message[:30] + "...")
        db.add(conv)
        db.commit()
        db.refresh(conv)
        conv_id = conv.conversation_id
        is_new_conversation = True
        
        # Schedule title generation
        background_tasks.add_task(generate_title, conv_id, request.message, db)
    
    # Schedule memory extraction
    background_tasks.add_task(extract_memory, user_id, request.message, db)

    # Fetch Memories
    memories = db.query(Memory).filter(Memory.user_id == user_id).all()
    memory_context = ""
    if memories:
        memory_context = "\n\nUser Facts/Memories:\n" + "\n".join([f"- {m.content}" for m in memories])

    messages_payload = [
        {"role": "system", "content": f"You are a helpful and friendly AI assistant. Please use emojis in your responses! 😊{memory_context}"}
    ]

    # Fetch history
    history = db.query(Message).filter(Message.conversation_id == conv_id, Message.deleted_at == None).order_by(Message.timestamp.asc()).all()
    # take last 10 messages for context
    for msg in history[-10:]:
        messages_payload.append({"role": "user", "content": msg.user_message})
        messages_payload.append({"role": "assistant", "content": msg.ai_response})
        
    messages_payload.append({"role": "user", "content": enhanced_msg})
    
    ollama_res = await generate_response(ollama_model, messages_payload)
    if "error" in ollama_res:
        if ollama_res["error"] == "timeout":
            raise HTTPException(status_code=504, detail="Error TIMEOUT")
        elif ollama_res["error"] == "unavailable":
            raise HTTPException(status_code=503, detail="Service Unavailable")
        elif ollama_res["error"] == "not_found":
            raise HTTPException(status_code=404, detail=f"Model '{ollama_model}' not found on Ollama server")
        else:
            raise HTTPException(status_code=500, detail="Error communicating with LLM")
            
    ai_text = ollama_res.get("response", "")
    
    # Store message
    msg = Message(
        user_id=user_id,
        model_used=request.model_id,
        user_message=request.message,
        ai_response=ai_text,
        conversation_id=conv_id
    )
    db.add(msg)
    
    # Increment usage
    setattr(usage, f"model_{group}_uses", current_uses + 1)
    db.commit()
    db.refresh(msg)
    
    return {
        "status": "success",
        "message_id": msg.message_id,
        "conversation_id": conv_id,
        "ai_response": ai_text,
        "model_used": request.model_id,
        "timestamp": msg.timestamp.isoformat(),
        "uses_remaining": {
            "llama2_7b_qwen2_7b": max(0, LIMITS[tier]["7b"] - usage.model_7b_uses) if LIMITS[tier]["7b"] != float('inf') else "unlimited",
            "llama3_8b": max(0, LIMITS[tier]["8b"] - usage.model_8b_uses) if LIMITS[tier]["8b"] != float('inf') else "unlimited",
            "llama2_13b": max(0, LIMITS[tier]["13b"] - usage.model_13b_uses) if LIMITS[tier]["13b"] != float('inf') else "unlimited"
        }
    }

@router.get("/conversations")
def get_conversations(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    user_id = current_user["user_id"]
    
    # 30-day cleanup of messages
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    db.query(Message).filter(Message.user_id == user_id, Message.timestamp < thirty_days_ago, Message.deleted_at == None).update({"deleted_at": datetime.utcnow()})
    db.commit()

    conversations = db.query(Conversation).filter(Conversation.user_id == user_id).order_by(Conversation.created_at.desc()).all()
    # Also filter out conversations with all deleted messages? For simplicity, just return all conversations
    
    return {"conversations": [{"conversation_id": c.conversation_id, "title": c.title} for c in conversations]}

@router.put("/conversation/{conversation_id}")
def rename_conversation(conversation_id: int, req: ConversationRename, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    user_id = current_user["user_id"]
    conv = db.query(Conversation).filter(Conversation.conversation_id == conversation_id, Conversation.user_id == user_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    conv.title = req.title
    db.commit()
    return {"status": "success", "message": "Conversation renamed", "title": conv.title}

@router.delete("/conversation/{conversation_id}")
def delete_conversation(conversation_id: int, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    user_id = current_user["user_id"]
    conv = db.query(Conversation).filter(Conversation.conversation_id == conversation_id, Conversation.user_id == user_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    messages = db.query(Message).filter(Message.user_id == user_id, Message.conversation_id == conversation_id).all()
    for m in messages:
        m.deleted_at = datetime.utcnow()
    
    db.delete(conv)
    db.commit()
    return {"status": "success", "message": "Conversation deleted"}

@router.get("/history")
def get_history(conversation_id: int = None, limit: int = 50, offset: int = 0, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    user_id = current_user["user_id"]
    
    query = db.query(Message).filter(Message.user_id == user_id, Message.deleted_at == None)
    if conversation_id:
        query = query.filter(Message.conversation_id == conversation_id)
        
    messages = query.order_by(Message.timestamp.desc()).offset(offset).limit(limit).all()
    count = query.count()
    
    return {
        "messages": [
            {
                "message_id": m.message_id,
                "model_used": m.model_used,
                "user_message": m.user_message,
                "ai_response": m.ai_response,
                "timestamp": m.timestamp.isoformat()
            } for m in messages
        ],
        "total_count": count
    }
