from flask import Flask
from flask_sqlalchemy_lite import SQLAlchemy
from sqlalchemy import Integer, String, DateTime, ForeignKey, select
from sqlalchemy.orm import DeclarativeBase, mapped_column, Mapped, relationship
from typing import List, Optional
from datetime import datetime


class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    whatsapp_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    brawlhalla_id: Mapped[Optional[str]] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    warnings: Mapped[List['Warning']] = relationship('Warning', back_populates='user', cascade='all, delete-orphan')

class Warning(Base):
    __tablename__ = 'warnings'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey('users.id'), nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped[User] = relationship('User', back_populates='warnings')