import logging
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.auth import generate_api_key, require_api_key
from app.database import Base, engine, get_db
from app.ingestion.fetcher import DataFetcher
from app.ingestion.price_monitor import PriceMonitor
from app.models import (  # noqa: F401 – ensure models are registered
    ApiKey,
    PriceHistory,
    Product,
    RequestLog,
    Webhook,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)

app = FastAPI(
    title="Product Price Monitoring System",
    description="API for tracking product prices across multiple sources.",
    version="1.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow the frontend (opened as a local file or dev server) to call the API.
# In production, replace the wildcard with your actual frontend origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten to e.g. ["http://localhost:5500"] in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create all tables on startup
Base.metadata.create_all(bind=engine)


# ------------------------------------------------------------------
# Public endpoints (no API key required)
# ------------------------------------------------------------------


@app.get("/health", tags=["health"])
def health_check():
    """Simple liveness probe."""
    return {"status": "ok"}


# ------------------------------------------------------------------
# API Key management
# ------------------------------------------------------------------


@app.post("/api-keys", tags=["api-keys"])
def create_api_key(
    name: str = Query(..., description="Human-readable label for the key"),
    db: Session = Depends(get_db),
):
    """Create a new API key.

    The raw key is returned **only once** in the response.  Store it
    securely — it cannot be retrieved again.
    """
    raw_key = generate_api_key()
    key_row = ApiKey(key=raw_key, name=name)
    db.add(key_row)
    db.commit()
    db.refresh(key_row)
    return {
        "id": key_row.id,
        "name": key_row.name,
        "key": raw_key,
        "created_at": key_row.created_at.isoformat(),
    }


# ------------------------------------------------------------------
# Ingestion / Refresh (requires API key)
# ------------------------------------------------------------------


@app.post("/refresh", tags=["ingestion"])
async def refresh(
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    """Trigger a full ingestion cycle across all supported marketplaces.

    Fetches the latest listings from Grailed, Fashionphile, and 1stDibs,
    compares prices against the database, and records any changes.
    Webhook notifications are sent for every detected price change.
    """
    monitor = PriceMonitor(db=db)
    summary = await monitor.run()
    return summary


@app.post("/ingest/{source}", tags=["ingestion"])
async def ingest_source(
    source: str,
    url: Optional[str] = Query(default=None, description="Remote URL to fetch from"),
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    """Trigger ingestion for a single marketplace *source*.

    Accepted sources: ``grailed``, ``fashionphile``, ``firstdibs``.
    Optionally pass a ``url`` query parameter to fetch live data
    instead of reading from the local sample files.
    """
    if source not in DataFetcher.SUPPORTED_SOURCES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown source '{source}'. "
                f"Supported: {', '.join(DataFetcher.SUPPORTED_SOURCES)}"
            ),
        )
    monitor = PriceMonitor(db=db)
    summary = await monitor.run_source(source, url=url)
    return summary


# ------------------------------------------------------------------
# Products (requires API key)
# ------------------------------------------------------------------


@app.get("/products", tags=["products"])
def list_products(
    category: Optional[str] = Query(default=None, description="Filter by category"),
    source: Optional[str] = Query(
        default=None, description="Filter by source (substring match on original_source)"
    ),
    min_price: Optional[float] = Query(
        default=None, description="Minimum latest price"
    ),
    max_price: Optional[float] = Query(
        default=None, description="Maximum latest price"
    ),
    limit: int = Query(default=50, ge=1, le=500, description="Page size"),
    offset: int = Query(default=0, ge=0, description="Offset for pagination"),
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    """List products with optional filters for category, source, and price range.

    Price filters operate on the **latest** recorded price for each product.
    """
    query = db.query(Product)

    if category:
        query = query.filter(Product.category == category)
    if source:
        query = query.filter(Product.original_source.contains(source))

    products = query.order_by(Product.id).offset(offset).limit(limit).all()

    result = []
    for p in products:
        latest = (
            db.query(PriceHistory.price)
            .filter(PriceHistory.product_id == p.id)
            .order_by(desc(PriceHistory.timestamp))
            .first()
        )
        latest_price = float(latest.price) if latest else None

        # Apply price filters
        if min_price is not None and (latest_price is None or latest_price < min_price):
            continue
        if max_price is not None and (latest_price is None or latest_price > max_price):
            continue

        result.append({
            "id": p.id,
            "name": p.name,
            "brand": p.brand,
            "category": p.category,
            "original_source": p.original_source,
            "latest_price": latest_price,
            "created_at": p.created_at.isoformat(),
            "updated_at": p.updated_at.isoformat(),
        })

    return {"count": len(result), "products": result}


@app.get("/products/{product_id}/history", tags=["products"])
def product_history(
    product_id: int,
    limit: int = Query(default=100, ge=1, le=1000, description="Max rows"),
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    """Return price history (trend) for a single product, newest first."""
    product = db.query(Product).filter(Product.id == product_id).first()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found.")

    history = (
        db.query(PriceHistory)
        .filter(PriceHistory.product_id == product_id)
        .order_by(desc(PriceHistory.timestamp))
        .limit(limit)
        .all()
    )

    return {
        "product_id": product.id,
        "product_name": product.name,
        "history": [
            {
                "id": h.id,
                "price": h.price,
                "source": h.source,
                "timestamp": h.timestamp.isoformat(),
            }
            for h in history
        ],
    }


# ------------------------------------------------------------------
# Analytics (requires API key)
# ------------------------------------------------------------------


@app.get("/analytics", tags=["analytics"])
def analytics(
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    """Aggregate statistics across all products and price history."""
    total_products = db.query(func.count(Product.id)).scalar() or 0
    total_price_records = db.query(func.count(PriceHistory.id)).scalar() or 0
    avg_price = db.query(func.avg(PriceHistory.price)).scalar()

    # Per-category breakdown
    category_rows = (
        db.query(
            Product.category,
            func.count(Product.id).label("product_count"),
        )
        .group_by(Product.category)
        .all()
    )

    # Count products that have more than one price_history entry (i.e. price changed)
    products_with_changes = (
        db.query(PriceHistory.product_id)
        .group_by(PriceHistory.product_id)
        .having(func.count(PriceHistory.id) > 1)
        .count()
    )

    return {
        "total_products": total_products,
        "total_price_records": total_price_records,
        "average_price": round(avg_price, 2) if avg_price is not None else None,
        "products_with_price_changes": products_with_changes,
        "categories": [
            {"category": row.category, "product_count": row.product_count}
            for row in category_rows
        ],
    }


# ------------------------------------------------------------------
# Webhooks (requires API key)
# ------------------------------------------------------------------


@app.post("/webhooks", tags=["webhooks"])
def register_webhook(
    url: str = Query(..., description="URL to receive price-change POSTs"),
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    """Register a new webhook URL for price-change notifications."""
    webhook = Webhook(url=url)
    db.add(webhook)
    db.commit()
    db.refresh(webhook)
    return {
        "id": webhook.id,
        "url": webhook.url,
        "is_active": webhook.is_active,
        "created_at": webhook.created_at.isoformat(),
    }


@app.get("/webhooks", tags=["webhooks"])
def list_webhooks(
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    """List all registered webhooks."""
    webhooks = db.query(Webhook).order_by(Webhook.id).all()
    return {
        "count": len(webhooks),
        "webhooks": [
            {
                "id": wh.id,
                "url": wh.url,
                "is_active": wh.is_active,
                "created_at": wh.created_at.isoformat(),
            }
            for wh in webhooks
        ],
    }


@app.delete("/webhooks/{webhook_id}", tags=["webhooks"])
def delete_webhook(
    webhook_id: int,
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    """Remove a registered webhook."""
    webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if webhook is None:
        raise HTTPException(status_code=404, detail="Webhook not found.")
    db.delete(webhook)
    db.commit()
    return {"detail": f"Webhook {webhook_id} deleted."}
