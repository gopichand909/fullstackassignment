import logging
from typing import Optional, List

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.auth import generate_api_key, require_api_key
from app.database import Base, engine, get_db
from app.ingestion.fetcher import DataFetcher
from app.ingestion.price_monitor import PriceMonitor
from app.models import (
    ApiKey,
    PriceHistory,
    Product,
    RequestLog,
    Webhook,
)

# Setup Logging
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables on startup
Base.metadata.create_all(bind=engine)


# ── Health Check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["health"])
def health_check():
    return {"status": "ok"}


# ── API Key Management ────────────────────────────────────────────────────────
@app.post("/api-keys", tags=["api-keys"])
def create_api_key(
    name: str = Query(..., description="Human-readable label for the key"),
    db: Session = Depends(get_db),
):
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


# ── Ingestion ─────────────────────────────────────────────────────────────────
@app.post("/refresh", tags=["ingestion"])
async def refresh(
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    monitor = PriceMonitor(db=db)
    summary = await monitor.run()
    return summary


@app.post("/ingest/{source}", tags=["ingestion"])
async def ingest_source(
    source: str,
    url: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    if source not in DataFetcher.SUPPORTED_SOURCES:
        raise HTTPException(status_code=400, detail=f"Unknown source '{source}'")
    monitor = PriceMonitor(db=db)
    summary = await monitor.run_source(source, url=url)
    return summary


# ── Products ──────────────────────────────────────────────────────────────────
@app.get("/products", tags=["products"])
def list_products(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    """Returns products with latest price and image metadata."""
    query = db.query(Product)
    
    if search:
        query = query.filter(Product.name.ilike(f"%{search}%"))
    if category:
        query = query.filter(Product.category == category)
    
    products = query.order_by(Product.id).offset(offset).limit(limit).all()
    
    result = []
    for p in products:
        latest = db.query(PriceHistory)\
            .filter(PriceHistory.product_id == p.id)\
            .order_by(desc(PriceHistory.timestamp))\
            .first()
            
        result.append({
            "id": p.id,
            "product_id": p.product_id,
            "name": p.name,
            "brand": p.brand,
            "price": latest.price if latest else 0.0,
            "url": p.product_url,
            "images": p.main_images,  # Fixed: Added to match app.js needs
            "updated_at": p.updated_at.isoformat()
        })
    return result


@app.get("/products/{product_id}/history", tags=["products"])
def product_history(
    product_id: int,
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
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
                # Fixed: Removed h.source because it's not in the PriceHistory model
                "timestamp": h.timestamp.isoformat(),
            }
            for h in history
        ],
    }


# ── Analytics ─────────────────────────────────────────────────────────────────
@app.get("/analytics", tags=["analytics"])
def get_analytics(
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
    total_products = db.query(func.count(Product.id)).scalar() or 0
    total_records = db.query(func.count(PriceHistory.id)).scalar() or 0
    avg_price = db.query(func.avg(PriceHistory.price)).scalar() or 0

    category_rows = (
        db.query(Product.category, func.count(Product.id))
        .group_by(Product.category).all()
    )

    # Count how many products have changed price
    products_with_changes = (
        db.query(PriceHistory.product_id)
        .group_by(PriceHistory.product_id)
        .having(func.count(PriceHistory.id) > 1)
        .count()
    )

    return {
        "total_products": total_products,
        "total_price_records": total_records,
        "average_price": round(avg_price, 2),
        "products_with_price_changes": products_with_changes,
        "category_distribution": {row[0]: row[1] for row in category_rows}
    }


# ── Webhooks ──────────────────────────────────────────────────────────────────
@app.post("/webhooks", tags=["webhooks"])
def register_webhook(
    url: str = Query(...),
    db: Session = Depends(get_db),
    _api_key: ApiKey = Depends(require_api_key),
):
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
def list_webhooks(db: Session = Depends(get_db), _api_key: ApiKey = Depends(require_api_key)):
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
    webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found.")
    db.delete(webhook)
    db.commit()
    return {"detail": f"Webhook {webhook_id} deleted."}