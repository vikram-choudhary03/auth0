"""
Gmail client — calls Phase A's backend endpoints to fetch email data.
Phase A handles Auth0 + Gmail API. We forward the user's Auth0 Bearer token.

Token resolution:
  1. If auth_token is provided directly (from frontend HTTP calls), use it.
  2. Otherwise, fetch it from the WS Gateway's token store (for OpenClaw calls).
"""

import httpx

from app.config import settings
from app.models.schemas import EmailContent, EmailMeta

GATEWAY_TOKEN_URL = "http://localhost:8002/api/token"


async def _resolve_token(user_id: str, auth_token: str = "") -> str:
    """Get the Auth0 JWT — either passed directly or from the gateway token store."""
    if auth_token:
        return auth_token

    # Fetch from gateway's in-memory token store
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                GATEWAY_TOKEN_URL,
                params={"user_id": user_id or "default"},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("token", "")
    except Exception:
        pass

    return ""


async def list_recent_emails(user_id: str, count: int = 10, auth_token: str = "") -> list[EmailMeta]:
    token = await _resolve_token(user_id, auth_token)
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(base_url=settings.phase_a_base_url, timeout=30) as client:
        resp = await client.get(
            "/api/gmail/messages",
            params={"user_id": user_id, "count": count},
            headers=headers,
        )
        resp.raise_for_status()
        return [EmailMeta(**e) for e in resp.json()]


async def get_email_content(user_id: str, email_id: str, auth_token: str = "") -> EmailContent:
    token = await _resolve_token(user_id, auth_token)
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(base_url=settings.phase_a_base_url, timeout=30) as client:
        resp = await client.get(
            f"/api/gmail/messages/{email_id}",
            params={"user_id": user_id},
            headers=headers,
        )
        resp.raise_for_status()
        return EmailContent(**resp.json())
