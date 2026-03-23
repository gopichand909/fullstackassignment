"""Asynchronous data fetcher for marketplace product listings.

Supports fetching from remote URLs (via httpx) and reading from local
sample JSON / CSV files.  Every HTTP request is retried up to
``max_retries`` times with exponential back-off on failure.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Convenience alias for the directory that ships sample data files.
_SAMPLE_DATA_DIR = Path(__file__).resolve().parent.parent / "sample_data"


class DataFetcher:
    """Fetch and normalise product listings from multiple marketplaces.

    Parameters
    ----------
    max_retries : int
        Maximum number of retry attempts for failed HTTP requests.
    timeout : float
        Per-request timeout in seconds.
    """

    SUPPORTED_SOURCES = ("grailed", "fashionphile", "firstdibs")

    def __init__(self, max_retries: int = 3, timeout: float = 30.0) -> None:
        self.max_retries = max_retries
        self.timeout = timeout

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def fetch_all(self) -> list[dict[str, Any]]:
        """Fetch from all supported sources concurrently and return a
        unified list of normalised product dicts."""

        tasks = [self.fetch_source(source) for source in self.SUPPORTED_SOURCES]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        products: list[dict[str, Any]] = []
        for source, result in zip(self.SUPPORTED_SOURCES, results):
            if isinstance(result, Exception):
                logger.error("Failed to fetch from %s: %s", source, result)
                continue
            products.extend(result)
        return products

    async def fetch_source(
        self,
        source: str,
        url: str | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch and normalise data for a single marketplace source.

        If *url* is provided the data is fetched over HTTP; otherwise the
        local sample-data file is read.
        """

        if url is not None:
            raw_text = await self._fetch_url(url)
        else:
            raw_text = await self._read_local(source)

        return self._parse(source, raw_text)

    # ------------------------------------------------------------------
    # HTTP fetching with retry
    # ------------------------------------------------------------------

    async def _fetch_url(self, url: str) -> str:
        """GET *url* with up to ``max_retries`` retry attempts."""

        last_exc: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.get(url)
                    response.raise_for_status()
                    return response.text
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                last_exc = exc
                wait = 2 ** attempt  # exponential back-off: 2, 4, 8 …
                logger.warning(
                    "Attempt %d/%d for %s failed (%s). Retrying in %ds …",
                    attempt,
                    self.max_retries,
                    url,
                    exc,
                    wait,
                )
                await asyncio.sleep(wait)

        raise RuntimeError(
            f"All {self.max_retries} attempts failed for {url}"
        ) from last_exc

    # ------------------------------------------------------------------
    # Local file reading
    # ------------------------------------------------------------------

    async def _read_local(self, source: str) -> str:
        """Read the sample-data file for *source* from disk."""

        file_map: dict[str, str] = {
            "grailed": "grailed.json",
            "fashionphile": "fashionphile.csv",
            "firstdibs": "firstdibs.json",
        }
        filename = file_map.get(source)
        if filename is None:
            raise ValueError(f"Unknown source: {source!r}")

        path = _SAMPLE_DATA_DIR / filename
        loop = asyncio.get_running_loop()
        text: str = await loop.run_in_executor(None, path.read_text)
        return text

    # ------------------------------------------------------------------
    # Parsing & normalisation
    # ------------------------------------------------------------------

    def _parse(self, source: str, raw_text: str) -> list[dict[str, Any]]:
        """Dispatch to the correct parser and return normalised dicts."""

        parsers = {
            "grailed": self._parse_grailed,
            "fashionphile": self._parse_fashionphile,
            "firstdibs": self._parse_firstdibs,
        }
        parser = parsers.get(source)
        if parser is None:
            raise ValueError(f"No parser registered for source: {source!r}")
        return parser(raw_text)

    # -- Grailed (JSON) ------------------------------------------------

    @staticmethod
    def _parse_grailed(raw_text: str) -> list[dict[str, Any]]:
        items = json.loads(raw_text)
        return [
            {
                "source_id": item["id"],
                "name": item["title"],
                "brand": item["designer"],
                "category": item["category"],
                "price": float(item["price"]),
                "source": item["url"],
                "marketplace": "grailed",
            }
            for item in items
        ]

    # -- Fashionphile (CSV) --------------------------------------------

    @staticmethod
    def _parse_fashionphile(raw_text: str) -> list[dict[str, Any]]:
        reader = csv.DictReader(io.StringIO(raw_text))
        return [
            {
                "source_id": row["id"],
                "name": row["name"],
                "brand": row["brand"],
                "category": row["category"],
                "price": float(row["price"]),
                "source": row["url"],
                "marketplace": "fashionphile",
            }
            for row in reader
        ]

    # -- 1stDibs (JSON) ------------------------------------------------

    @staticmethod
    def _parse_firstdibs(raw_text: str) -> list[dict[str, Any]]:
        items = json.loads(raw_text)
        return [
            {
                "source_id": item["listing_id"],
                "name": item["item_name"],
                "brand": item["maker"],
                "category": item["item_category"],
                "price": float(item["asking_price"]),
                "source": item["listing_url"],
                "marketplace": "firstdibs",
            }
            for item in items
        ]
