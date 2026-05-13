from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any

class UserSignup(BaseModel):
    username: str = Field(..., min_length=3, max_length=20)
    password: str = Field(..., min_length=8)
    email: EmailStr

class UserLogin(BaseModel):
    username: str
    password: str

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=5000)
    model_id: str
    conversation_id: Optional[int] = None

class WebAuthnRegisterOptions(BaseModel):
    username: str = Field(..., min_length=3, max_length=20)
    email: EmailStr

class WebAuthnVerify(BaseModel):
    session_id: str
    credential: Dict[str, Any]
