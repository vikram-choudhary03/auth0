"""
Gmail client — calls Phase A's backend endpoints to fetch email data.
Phase A handles Auth0 + Gmail API. We forward the user's Auth0 Bearer token.
"""

import httpx

from app.config import settings
from app.models.schemas import EmailContent, EmailMeta


async def list_recent_emails(user_id: str, count: int = 10, auth_token: str = "") -> list[EmailMeta]:
    headers = {}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    async with httpx.AsyncClient(base_url=settings.phase_a_base_url, timeout=30) as client:
        resp = await client.get(
            "/api/gmail/messages",
            params={"user_id": user_id, "count": count},
            headers=headers,
        )
        resp.raise_for_status()
        return [EmailMeta(**e) for e in resp.json()]


async def get_email_content(user_id: str, email_id: str, auth_token: str = "") -> EmailContent:
    headers = {}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    async with httpx.AsyncClient(base_url=settings.phase_a_base_url, timeout=30) as client:
        resp = await client.get(
            f"/api/gmail/messages/{email_id}",
            params={"user_id": user_id},
            headers=headers,
        )
        resp.raise_for_status()
        return EmailContent(**resp.json())
