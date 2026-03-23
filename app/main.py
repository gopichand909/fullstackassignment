from fastapi import FastAPI

from app.database import engine, Base
from app.models import Product, PriceHistory  # noqa: F401 – ensure models are registered

app = FastAPI(
    title="Product Price Monitoring System",
    description="API for tracking product prices across multiple sources.",
    version="1.0.0",
)

# Create all tables on startup
Base.metadata.create_all(bind=engine)


@app.get("/health", tags=["health"])
def health_check():
    """Simple liveness probe."""
    return {"status": "ok"}
