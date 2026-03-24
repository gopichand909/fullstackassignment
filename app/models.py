from datetime import datetime
from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, JSON
)
# Note: Ensure you have added JSON to your imports as shown above
from sqlalchemy.orm import relationship

from app.database import Base


class Product(Base):
    """
    Stores product metadata from output2.csv.
    
    This model matches the structure of the CSV ingestion and provides 
    the necessary fields for the frontend dashboard.
    """
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    product_id = Column(String(255), unique=True, index=True)  # From CSV 'product_id'
    name = Column(String(511), nullable=False, index=True)       # From CSV 'model'
    brand = Column(String(255), nullable=False)
    brand_id = Column(String(255), nullable=True)              # From CSV 'brand_id'
    category = Column(String(255), nullable=True, index=True)
    product_url = Column(String(1024), nullable=False)         # From CSV 'product_url'
    
    # Missing Column: Required for storing image lists from CSV
    main_images = Column(JSON, nullable=True) 

    # Metadata: Required for the dashboard 'Updated' column and API tracking
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    price_history = relationship(
        "PriceHistory", 
        back_populates="product", 
        cascade="all, delete-orphan"
    )


class PriceHistory(Base):
    """Tracks price changes over time."""
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(
        Integer, 
        ForeignKey("products.id", ondelete="CASCADE"), 
        nullable=False
    )
    price = Column(Float, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    product = relationship("Product", back_populates="price_history")


# API Key, Request Logging & Webhook models
# ------------------------------------------------------------------

class ApiKey(Base):
    """Stores API keys used for authenticating requests."""
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(64), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    request_logs = relationship(
        "RequestLog",
        back_populates="api_key",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<ApiKey(id={self.id}, name='{self.name}', is_active={self.is_active})>"


class RequestLog(Base):
    """Logs every authenticated API request."""
    __tablename__ = "request_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    api_key_id = Column(
        Integer,
        ForeignKey("api_keys.id", ondelete="CASCADE"),
        nullable=False,
    )
    method = Column(String(10), nullable=False)
    path = Column(String(512), nullable=False)
    status_code = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    api_key = relationship("ApiKey", back_populates="request_logs")

    __table_args__ = (
        Index("ix_request_logs_api_key_id", "api_key_id"),
        Index("ix_request_logs_timestamp", "timestamp"),
    )

    def __repr__(self) -> str:
        return (
            f"<RequestLog(id={self.id}, method='{self.method}', "
            f"path='{self.path}', status={self.status_code})>"
        )


class Webhook(Base):
    """Stores registered webhook URLs for price-change notifications."""
    __tablename__ = "webhooks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    url = Column(String(512), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self) -> str:
        return f"<Webhook(id={self.id}, url='{self.url}', is_active={self.is_active})>"