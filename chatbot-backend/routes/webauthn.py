from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from datetime import datetime, date, timedelta
import uuid
import json
from pydantic import BaseModel

from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
    base64url_to_bytes
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    UserVerificationRequirement
)

from database import get_db, User, Usage, WebAuthnCredential, AuthChallenge
from models import WebAuthnRegisterOptions, WebAuthnVerify
from services.auth_service import create_access_token

router = APIRouter()

RP_ID = "localhost" # Adjust for production
RP_NAME = "LLM Chatbot"
ORIGIN = "http://localhost:8000" # Adjust for production

@router.post("/register/options")
def register_options(user_data: WebAuthnRegisterOptions, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter((User.username == user_data.username) | (User.email == user_data.email)).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="Username or email already exists")

    user_id = str(uuid.uuid4())

    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=user_id.encode("utf-8"),
        user_name=user_data.username,
        user_display_name=user_data.username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            user_verification=UserVerificationRequirement.PREFERRED
        )
    )

    session_id = str(uuid.uuid4())
    options_json = json.loads(options_to_json(options))
    expected_challenge = options_json["challenge"]

    challenge_data = {
        "challenge": expected_challenge,
        "username": user_data.username,
        "email": user_data.email
    }

    challenge_entry = AuthChallenge(
        session_id=session_id,
        challenge=json.dumps(challenge_data),
        expires_at=datetime.utcnow() + timedelta(minutes=5)
    )
    db.add(challenge_entry)
    db.commit()

    return {
        "options": options_json,
        "session_id": session_id
    }

@router.post("/register/verify")
def register_verify(verify_data: WebAuthnVerify, db: Session = Depends(get_db)):
    session_id = verify_data.session_id
    challenge_entry = db.query(AuthChallenge).filter(AuthChallenge.session_id == session_id).first()
    
    if not challenge_entry or challenge_entry.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Challenge expired or invalid")
    
    challenge_data = json.loads(challenge_entry.challenge)
    expected_challenge = challenge_data["challenge"]
    username = challenge_data["username"]
    email = challenge_data["email"]

    try:
        verification = verify_registration_response(
            credential=verify_data.credential,
            expected_challenge=base64url_to_bytes(expected_challenge),
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    new_user = User(
        username=username,
        email=email,
        password_hash="passkey", # Unused placeholder
        tier="free"
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    new_usage = Usage(
        user_id=new_user.user_id,
        month_start_date=date.today()
    )
    db.add(new_usage)

    new_cred = WebAuthnCredential(
        id=verification.credential_id.hex(),
        user_id=new_user.user_id,
        public_key=verification.credential_public_key,
        sign_count=verification.sign_count
    )
    db.add(new_cred)

    db.delete(challenge_entry)
    db.commit()

    token = create_access_token({
        "user_id": new_user.user_id,
        "username": new_user.username,
        "tier": new_user.tier
    })

    return {
        "status": "success",
        "token": token,
        "username": new_user.username,
        "tier": new_user.tier
    }

class WebAuthnLoginOptions(BaseModel):
    username: str

@router.post("/login/options")
def login_options(login_data: WebAuthnLoginOptions, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == login_data.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    creds = db.query(WebAuthnCredential).filter(WebAuthnCredential.user_id == user.user_id).all()
    if not creds:
        raise HTTPException(status_code=400, detail="No passkeys found for this user")

    options = generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=[{"id": base64url_to_bytes(c.id).decode('latin1') if False else base64url_to_bytes(c.id), "type": "public-key"} for c in creds] # base64url_to_bytes handles this. Actually webauthn wants bytes for ID in allow_credentials. Wait, c.id is hex string.
    )

    # Note: c.id is hex. Let's fix this.
    options = generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=[{"id": bytes.fromhex(c.id), "type": "public-key"} for c in creds]
    )


    session_id = str(uuid.uuid4())
    options_json = json.loads(options_to_json(options))
    expected_challenge = options_json["challenge"]

    challenge_data = {
        "challenge": expected_challenge,
        "user_id": user.user_id
    }

    challenge_entry = AuthChallenge(
        session_id=session_id,
        challenge=json.dumps(challenge_data),
        user_id=user.user_id,
        expires_at=datetime.utcnow() + timedelta(minutes=5)
    )
    db.add(challenge_entry)
    db.commit()

    return {
        "options": options_json,
        "session_id": session_id
    }

@router.post("/login/verify")
def login_verify(verify_data: WebAuthnVerify, db: Session = Depends(get_db)):
    session_id = verify_data.session_id
    challenge_entry = db.query(AuthChallenge).filter(AuthChallenge.session_id == session_id).first()
    
    if not challenge_entry or challenge_entry.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Challenge expired or invalid")
    
    challenge_data = json.loads(challenge_entry.challenge)
    expected_challenge = challenge_data["challenge"]
    user_id = challenge_data["user_id"]

    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    cred_id_hex = verify_data.credential.get("id")
    try:
        cred_id_bytes = base64url_to_bytes(cred_id_hex)
        db_cred = db.query(WebAuthnCredential).filter(WebAuthnCredential.id == cred_id_bytes.hex()).first()
    except:
        db_cred = None

    if not db_cred:
        raise HTTPException(status_code=400, detail="Credential not recognized")

    try:
        verification = verify_authentication_response(
            credential=verify_data.credential,
            expected_challenge=base64url_to_bytes(expected_challenge),
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
            credential_public_key=db_cred.public_key,
            credential_current_sign_count=db_cred.sign_count
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    db_cred.sign_count = verification.new_sign_count
    db.delete(challenge_entry)
    db.commit()

    token = create_access_token({
        "user_id": user.user_id,
        "username": user.username,
        "tier": user.tier
    })

    return {
        "token": token,
        "username": user.username,
        "tier": user.tier
    }