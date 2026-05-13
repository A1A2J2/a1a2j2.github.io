from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, Date, LargeBinary
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime
from config import settings

engine = create_engine(settings.DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    user_id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    tier = Column(String, default="free", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    stripe_customer_id = Column(String, nullable=True)
    subscription_id = Column(String, nullable=True)
    paid_since = Column(DateTime, nullable=True)
    last_login = Column(DateTime, nullable=True)

class WebAuthnCredential(Base):
    __tablename__ = "webauthn_credentials"
    id = Column(String, primary_key=True, index=True)  # The credential ID
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    public_key = Column(LargeBinary, nullable=False)
    sign_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class AuthChallenge(Base):
    __tablename__ = "auth_challenges"
    session_id = Column(String, primary_key=True, index=True)
    challenge = Column(String, nullable=False)
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=True) # None for login, filled for register
    expires_at = Column(DateTime, nullable=False)

class Usage(Base):
    __tablename__ = "usage"
    usage_id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.user_id"), unique=True, nullable=False)
    model_7b_uses = Column(Integer, default=0)
    model_14b_uses = Column(Integer, default=0)
    model_32b_uses = Column(Integer, default=0)
    month_start_date = Column(Date, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Message(Base):
    __tablename__ = "messages"
    message_id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    model_used = Column(String, nullable=False)
    user_message = Column(String, nullable=False)
    ai_response = Column(String, nullable=False)
    tokens_estimated = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    conversation_id = Column(Integer, nullable=True)
    deleted_at = Column(DateTime, nullable=True)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
