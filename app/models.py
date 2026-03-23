from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from app.database import Base


class Product(Base):
    """Stores product metadata.

    Columns:
        id              – auto-incrementing primary key
        name            – product display name
        brand           – manufacturer / brand
        category        – product category (e.g. Electronics, Clothing)
        original_source – the original marketplace or retailer URL
        created_at      – row creation timestamp
        updated_at      – last-modified timestamp
    """

    __tablename__ = "products"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    brand = Column(String(255), nullable=False)
    category = Column(String(255), nullable=False, index=True)
    original_source = Column(String(512), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # One-to-many: a product has many price history records
    price_history = relationship(
        "PriceHistory",
        back_populates="product",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )

    def __repr__(self) -> str:
        return f"<Product(id={self.id}, name='{self.name}', brand='{self.brand}')>"


class PriceHistory(Base):
    """Records a single price observation for a product.

    Columns:
        id         – auto-incrementing primary key
        product_id – FK → products.id
        price      – observed price value
        timestamp  – when the price was recorded
        source     – marketplace / retailer that reported this price
    """

    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(
        Integer,
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
    )
    price = Column(Float, nullable=False)
    timestamp = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
    source = Column(String(512), nullable=False)

    product = relationship("Product", back_populates="price_history")

    # Composite & single-column indexes for fast queries over millions of rows
    __table_args__ = (
        Index("ix_price_history_product_id", "product_id"),
        Index("ix_price_history_timestamp", "timestamp"),
        Index("ix_price_history_product_id_timestamp", "product_id", "timestamp"),
    )

    def __repr__(self) -> str:
        return (
            f"<PriceHistory(id={self.id}, product_id={self.product_id}, "
            f"price={self.price}, source='{self.source}')>"
        )


# ------------------------------------------------------------------
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
