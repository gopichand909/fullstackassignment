"""Webhook notification dispatcher.

When a price change is detected the dispatcher POSTs the change
details to every active webhook URL.  Delivery is best-effort
(fire-and-forget) so that ingestion is never blocked by slow or
failing webhook endpoints.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.models import Webhook

logger = logging.getLogger(__name__)


async def dispatch_price_change(
    db: Session,
    product_name: str,
    old_price: float | None,
    new_price: float,
    source: str,
) -> None:
    """POST the price-change payload to all active webhook URLs.

    Parameters
    ----------
    db : Session
        Database session used to query active webhooks.
    product_name : str
        Human-readable name of the product whose price changed.
    old_price : float | None
        Previous price (``None`` for brand-new products).
    new_price : float
        Newly observed price.
    source : str
        Marketplace URL that reported the new price.
    """

    webhooks = db.query(Webhook).filter(Webhook.is_active.is_(True)).all()
    if not webhooks:
        return

    payload: dict[str, Any] = {
        "event": "price_change",
        "product_name": product_name,
        "old_price": old_price,
        "new_price": new_price,
        "source": source,
        "timestamp": datetime.utcnow().isoformat(),
    }

    async def _post(url: str) -> None:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)
                logger.info(
                    "Webhook delivered to %s (status %d)", url, resp.status_code
                )
        except Exception:
            logger.warning("Webhook delivery to %s failed", url, exc_info=True)

    tasks = [_post(wh.url) for wh in webhooks]
    await asyncio.gather(*tasks, return_exceptions=True)
