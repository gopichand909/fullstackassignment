import logging
from typing import Optional

from fastapi import Depends, FastAPI, Query

from app.database import Base, engine, get_db
from app.ingestion.fetcher import DataFetcher
from app.ingestion.price_monitor import PriceMonitor
from app.models import PriceHistory, Product  # noqa: F401 – ensure models are registered

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)

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


# ------------------------------------------------------------------
# Ingestion endpoints
# ------------------------------------------------------------------


@app.post("/ingest", tags=["ingestion"])
async def ingest_all(db=Depends(get_db)):
    """Trigger a full ingestion cycle across all supported marketplaces.

    Fetches the latest listings from Grailed, Fashionphile, and 1stDibs,
    compares prices against the database, and records any changes.
    """
    monitor = PriceMonitor(db=db)
    summary = await monitor.run()
    return summary


@app.post("/ingest/{source}", tags=["ingestion"])
async def ingest_source(
    source: str,
    url: Optional[str] = Query(default=None, description="Remote URL to fetch from"),
    db=Depends(get_db),
):
    """Trigger ingestion for a single marketplace *source*.

    Accepted sources: ``grailed``, ``fashionphile``, ``firstdibs``.
    Optionally pass a ``url`` query parameter to fetch live data
    instead of reading from the local sample files.
    """
    if source not in DataFetcher.SUPPORTED_SOURCES:
        return {
            "error": f"Unknown source '{source}'. "
            f"Supported: {', '.join(DataFetcher.SUPPORTED_SOURCES)}"
        }
    monitor = PriceMonitor(db=db)
    summary = await monitor.run_source(source, url=url)
    return summary
