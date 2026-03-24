from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.ingestion.fetcher import DataFetcher
from app.models import PriceHistory, Product
from app.webhooks import dispatch_price_change

logger = logging.getLogger(__name__)


class PriceMonitor:
    """Compare live marketplace prices against the database and record changes.

    Parameters
    ----------
    db : sqlalchemy.orm.Session
        An active SQLAlchemy session used for all database operations.
    fetcher : DataFetcher | None
        An optional :class:`DataFetcher` instance. A default one is
        created when not supplied.
    """

    def __init__(
        self,
        db: Session,
        fetcher: DataFetcher | None = None,
    ) -> None:
        self.db = db
        self.fetcher = fetcher or DataFetcher()
        self._price_changes: list[dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self) -> dict[str, Any]:
        """Execute a full ingestion cycle using the unified CSV source.

        Returns a summary dict with counts of created, updated, and
        unchanged products.
        """

        products = await self.fetcher.fetch_all()
        logger.info("Fetched %d product listings from unified source", len(products))

        created = 0
        updated = 0
        unchanged = 0

        for product_data in products:
            result = self._process_product(product_data)
            if result == "created":
                created += 1
            elif result == "updated":
                updated += 1
            else:
                unchanged += 1

        self.db.commit()

        # Dispatch webhook notifications for all detected price changes
        await self._dispatch_webhooks()

        summary = {
            "total_fetched": len(products),
            "created": created,
            "updated": updated,
            "unchanged": unchanged,
        }
        logger.info("Ingestion cycle complete: %s", summary)
        return summary

    async def run_source(self, source: str, url: str | None = None) -> dict[str, Any]:
        """Ingest from the marketplace source. 
        
        Note: With the unified CSV, 'source' is usually 'csv_import'.
        """

        products = await self.fetcher.fetch_source(source, url=url)
        logger.info("Fetched %d listings from %s", len(products), source)

        created = 0
        updated = 0
        unchanged = 0

        for product_data in products:
            result = self._process_product(product_data)
            if result == "created":
                created += 1
            elif result == "updated":
                updated += 1
            else:
                unchanged += 1

        self.db.commit()
        await self._dispatch_webhooks()

        return {
            "source": source,
            "total_fetched": len(products),
            "created": created,
            "updated": updated,
            "unchanged": unchanged,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _process_product(self, data: dict[str, Any]) -> str:
        """Process a single normalised product dict.

        Returns ``"created"``, ``"updated"``, or ``"unchanged"``.
        """

        product = self._find_product(data)

        if product is None:
            product = self._create_product(data)
            self._record_price(product, data["price"], data["source"])
            return "created"

        latest_price = self._get_latest_price(product.id)

        # Detect price changes or first-time history for existing product
        if latest_price is None or abs(latest_price - data["price"]) > 0.01:
            self._update_product(product)
            self._record_price(product, data["price"], data["source"])
            self._price_changes.append({
                "product_name": product.name,
                "old_price": latest_price,
                "new_price": data["price"],
                "source": data["source"],
            })
            logger.info(
                "Price change for '%s': %s -> %s",
                product.name, latest_price, data["price"]
            )
            return "updated"

        return "unchanged"

    def _find_product(self, data: dict[str, Any]) -> Product | None:
        """Look up existing product by its unique source URL or source ID."""
        # Using original_source (URL) as the unique identifier for lookups
        return (
            self.db.query(Product)
            .filter(Product.original_source == data["source"])
            .first()
        )

    def _create_product(self, data: dict[str, Any]) -> Product:
        """Insert a brand-new ``Product`` row."""

        product = Product(
            name=data["name"],
            brand=data["brand"],
            category=data["category"],
            original_source=data["source"],
        )
        self.db.add(product)
        self.db.flush() # Flush to get the generated product.id
        logger.info("Created product: %s", product.name)
        return product

    def _update_product(self, product: Product) -> None:
        """Update the product timestamp."""
        product.updated_at = datetime.utcnow()

    def _get_latest_price(self, product_id: int) -> float | None:
        """Get the latest recorded price from history."""
        row = (
            self.db.query(PriceHistory.price)
            .filter(PriceHistory.product_id == product_id)
            .order_by(desc(PriceHistory.timestamp))
            .first()
        )
        return float(row.price) if row is not None else None

    def _record_price(self, product: Product, price: float, source: str) -> None:
        """Insert new PriceHistory record."""
        entry = PriceHistory(
            product_id=product.id,
            price=price,
            source=source,
        )
        self.db.add(entry)

    async def _dispatch_webhooks(self) -> None:
        """Fire notifications for detected changes."""
        for change in self._price_changes:
            await dispatch_price_change(
                db=self.db,
                product_name=change["product_name"],
                old_price=change["old_price"],
                new_price=change["new_price"],
                source=change["source"],
            )
        self._price_changes.clear()