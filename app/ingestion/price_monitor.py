"""Price Monitor – detects price changes and persists them to the database.

The ``PriceMonitor`` class is the central orchestrator of the ingestion
pipeline.  It uses :class:`DataFetcher` to pull listings from every
supported marketplace, compares each price against the most recent
``PriceHistory`` row for that product, and – when a difference is found –
updates the ``Product`` record and inserts a new ``PriceHistory`` entry.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.ingestion.fetcher import DataFetcher
from app.models import PriceHistory, Product

logger = logging.getLogger(__name__)


class PriceMonitor:
    """Compare live marketplace prices against the database and record changes.

    Parameters
    ----------
    db : sqlalchemy.orm.Session
        An active SQLAlchemy session used for all database operations.
    fetcher : DataFetcher | None
        An optional :class:`DataFetcher` instance.  A default one is
        created when not supplied.
    """

    def __init__(
        self,
        db: Session,
        fetcher: DataFetcher | None = None,
    ) -> None:
        self.db = db
        self.fetcher = fetcher or DataFetcher()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self) -> dict[str, Any]:
        """Execute a full ingestion cycle.

        Returns a summary dict with counts of created, updated, and
        unchanged products.
        """

        products = await self.fetcher.fetch_all()
        logger.info("Fetched %d product listings across all sources", len(products))

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
        summary = {
            "total_fetched": len(products),
            "created": created,
            "updated": updated,
            "unchanged": unchanged,
        }
        logger.info("Ingestion cycle complete: %s", summary)
        return summary

    async def run_source(self, source: str, url: str | None = None) -> dict[str, Any]:
        """Ingest from a single marketplace *source*.

        Parameters
        ----------
        source : str
            One of the supported marketplace identifiers
            (``grailed``, ``fashionphile``, ``firstdibs``).
        url : str | None
            If provided, data is fetched from this URL instead of
            the local sample file.
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

        if latest_price is None or latest_price != data["price"]:
            self._update_product(product)
            self._record_price(product, data["price"], data["source"])
            logger.info(
                "Price change for '%s': %s -> %s (source: %s)",
                product.name,
                latest_price,
                data["price"],
                data["source"],
            )
            return "updated"

        return "unchanged"

    def _find_product(self, data: dict[str, Any]) -> Product | None:
        """Look up an existing product by name, brand, and source URL."""

        return (
            self.db.query(Product)
            .filter(
                Product.name == data["name"],
                Product.brand == data["brand"],
                Product.original_source == data["source"],
            )
            .first()
        )

    def _create_product(self, data: dict[str, Any]) -> Product:
        """Insert a brand-new ``Product`` row and flush to obtain its id."""

        product = Product(
            name=data["name"],
            brand=data["brand"],
            category=data["category"],
            original_source=data["source"],
        )
        self.db.add(product)
        self.db.flush()
        logger.info("Created new product: %s (brand=%s)", product.name, product.brand)
        return product

    def _update_product(self, product: Product) -> None:
        """Touch the ``updated_at`` timestamp on a product."""

        product.updated_at = datetime.utcnow()  # type: ignore[assignment]

    def _get_latest_price(self, product_id: int) -> float | None:
        """Return the most recent recorded price for *product_id*, or
        ``None`` if no history exists yet."""

        row = (
            self.db.query(PriceHistory.price)
            .filter(PriceHistory.product_id == product_id)
            .order_by(desc(PriceHistory.timestamp))
            .first()
        )
        return float(row.price) if row is not None else None

    def _record_price(self, product: Product, price: float, source: str) -> None:
        """Insert a new ``PriceHistory`` row."""

        entry = PriceHistory(
            product_id=product.id,
            price=price,
            source=source,
        )
        self.db.add(entry)
