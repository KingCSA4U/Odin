from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List, Optional
from datetime import datetime

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    whatsapp_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    brawlhalla_id: Mapped[Optional[str]] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    # Cached Stats for Leaderboard
    last_elo: Mapped[int] = mapped_column(Integer, default=0)
    last_tier: Mapped[str] = mapped_column(String(50), default='Unranked')
    stats_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    warnings: Mapped[List['Warning']] = relationship('Warning', back_populates='user', cascade='all, delete-orphan')

class Warning(db.Model):
    __tablename__ = 'warnings'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey('users.id'), nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped[User] = relationship('User', back_populates='warnings')
