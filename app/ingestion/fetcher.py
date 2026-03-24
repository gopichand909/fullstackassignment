from __future__ import annotations

import ast
import asyncio
import csv
import io
import logging
from pathlib import Path
from typing import Any
import httpx

logger = logging.getLogger(__name__)

# Directory where the project expects the CSV file
_ROOT_DIR = Path(__file__).resolve().parent.parent


class DataFetcher:
    """Fetch and normalise product listings from a unified CSV source.

    Parameters
    ----------
    max_retries : int
        Maximum number of retry attempts for failed HTTP requests.
    timeout : float
        Per-request timeout in seconds.
    """

    # Consolidating to the unified CSV source
    SUPPORTED_SOURCES = ("csv_import",)

    def __init__(self, max_retries: int = 3, timeout: float = 30.0) -> None:
        self.max_retries = max_retries
        self.timeout = timeout
        # Default local path for the unified data
        self.csv_path = _ROOT_DIR / "output2.csv"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def fetch_all(self) -> list[dict[str, Any]]:
        """Fetch from all supported sources. Currently optimized for output2.csv."""
        # For simplicity in the unified version, we call our main source
        return await self.fetch_source("csv_import")

    async def fetch_source(
        self,
        source: str,
        url: str | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch and normalise data from the CSV source.

        If *url* is provided the CSV is fetched over HTTP; otherwise the
        local output2.csv file is read.
        """
        if url is not None:
            raw_text = await self._fetch_url(url)
        else:
            raw_text = await self._read_local()

        return self._parse_csv(raw_text)

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
                wait = 2 ** attempt
                logger.warning(
                    "Attempt %d/%d failed for %s. Retrying in %ds...",
                    attempt, self.max_retries, url, wait
                )
                await asyncio.sleep(wait)

        raise RuntimeError(
            f"All {self.max_retries} attempts failed for {url}"
        ) from last_exc

    # ------------------------------------------------------------------
    # Local file reading
    # ------------------------------------------------------------------

    async def _read_local(self) -> str:
        """Read output2.csv from disk asynchronously."""
        if not self.csv_path.exists():
            logger.error("File not found: %s", self.csv_path)
            return ""

        loop = asyncio.get_running_loop()
        # Offload blocking I/O to a thread pool
        text: str = await loop.run_in_executor(None, self.csv_path.read_text, "utf-8")
        return text

    # ------------------------------------------------------------------
    # Parsing & normalisation
    # ------------------------------------------------------------------

    def _parse_csv(self, raw_text: str) -> list[dict[str, Any]]:
        """Parses the unified CSV format into normalized product dictionaries."""
        if not raw_text.strip():
            return []

        reader = csv.DictReader(io.StringIO(raw_text))
        products = []

        for row in reader:
            # Safely parse the 'main_images' string back into a Python list
            try:
                raw_images = row.get("main_images", "[]")
                # Using ast.literal_eval is safer than json.loads for single-quoted strings
                images = ast.literal_eval(raw_images) if raw_images else []
            except (ValueError, SyntaxError):
                logger.warning("Failed to parse images for product %s", row.get("product_id"))
                images = []

            products.append({
                "source_id": row.get("product_id"),
                "name": row.get("model"),
                "brand": row.get("brand"),
                "category": "General",  # Defaults to general as category isn't in output2.csv
                "price": float(row.get("price", 0)),
                "source": row.get("product_url"),
                "images": images,
                "marketplace": "unified_csv"
            })

        return products