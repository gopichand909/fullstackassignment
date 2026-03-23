from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    ForeignKey,
    Index,
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
