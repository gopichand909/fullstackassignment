"""API-key authentication and request-logging middleware.

Every request (except ``/health`` and ``/docs``) must include an
``X-API-Key`` header whose value matches an active row in the
``api_keys`` table.  Each authenticated call is recorded in the
``request_logs`` table.
"""

from __future__ import annotations

import secrets
from datetime import datetime

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, RequestLog

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

# Paths that do NOT require authentication.
_PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}


def _is_public(path: str) -> bool:
    return path in _PUBLIC_PATHS


async def require_api_key(
    request: Request,
    api_key: str | None = Depends(_api_key_header),
    db: Session = Depends(get_db),
) -> ApiKey:
    """FastAPI dependency: validate the API key and log the request.

    Returns the :class:`ApiKey` row on success; raises *403* otherwise.
    """

    if _is_public(request.url.path):
        # Shouldn't normally reach here because public routes won't
        # declare this dependency, but guard just in case.
        return None  # type: ignore[return-value]

    if api_key is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing X-API-Key header.",
        )

    key_row = (
        db.query(ApiKey)
        .filter(ApiKey.key == api_key, ApiKey.is_active.is_(True))
        .first()
    )
    if key_row is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or inactive API key.",
        )

    # Log the request
    log_entry = RequestLog(
        api_key_id=key_row.id,
        method=request.method,
        path=str(request.url.path),
        timestamp=datetime.utcnow(),
    )
    db.add(log_entry)
    db.commit()

    return key_row


def generate_api_key() -> str:
    """Return a cryptographically random 48-character hex key."""
    return secrets.token_hex(24)
