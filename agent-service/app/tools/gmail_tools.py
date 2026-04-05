"""
Agent tools — the functions OpenClaw invokes as skills.
Each tool is a self-contained action that combines Gmail data (Phase A) + Ollama (Phase B).
"""

from app.models.schemas import DraftResponse, SummaryResponse
import httpx

from app.config import settings
from app.services import gmail_client, ollama_service


def _emails_to_text(emails) -> str:
    lines = []
    for e in emails:
        lines.append(f"- [{e.date}] From: {e.sender} | Subject: {e.subject}\n  {e.snippet}")
    return "\n".join(lines)


async def list_recent_emails(user_id: str, count: int = 10, auth_token: str = "") -> list[dict]:
    emails = await gmail_client.list_recent_emails(user_id, count, auth_token=auth_token)
    return [e.model_dump() for e in emails]


async def summarize_emails(user_id: str, query: str | None = None, auth_token: str = "") -> SummaryResponse:
    emails = await gmail_client.list_recent_emails(user_id, count=10, auth_token=auth_token)
    emails_text = _emails_to_text(emails)
    summary = ollama_service.summarize_emails(emails_text, query=query)
    return SummaryResponse(summary=summary, email_count=len(emails))


async def classify_emails(user_id: str, auth_token: str = "") -> str:
    emails = await gmail_client.list_recent_emails(user_id, count=10, auth_token=auth_token)
    emails_text = _emails_to_text(emails)
    return ollama_service.classify_emails(emails_text)


async def get_email_content(user_id: str, email_id: str, auth_token: str = "") -> dict:
    email = await gmail_client.get_email_content(user_id, email_id, auth_token=auth_token)
    return email.model_dump()


async def draft_reply(user_id: str, email_id: str, instruction: str, auth_token: str = "") -> DraftResponse:
    email = await gmail_client.get_email_content(user_id, email_id, auth_token=auth_token)
    body = ollama_service.draft_reply(email.body, email.subject, instruction)
    return DraftResponse(
        email_id=email_id,
        subject=f"Re: {email.subject}",
        draft_body=body,
    )


_pending_sends = {}  # confirmation_id -> { to, subject, body, created_at }


async def send_email(
    user_id: str, to: str, subject: str, body: str, confirm: bool = False, auth_token: str = ""
) -> dict:
    """Send email via backend. ALWAYS requires two-step confirmation.

    Step 1: confirm=False → returns preview + confirmation_id
    Step 2: confirm=True with same details → checks pending, then sends
    """
    import time

    # Step 1: Always return preview first (even if confirm=True on first call)
    confirmation_id = f"{to}:{subject}"

    if not confirm or confirmation_id not in _pending_sends:
        # Store as pending and return preview
        _pending_sends[confirmation_id] = {
            "to": to, "subject": subject, "body": body,
            "created_at": time.time(),
        }
        return {
            "status": "pending_confirmation",
            "tell_user": f"I've drafted an email to {to} with subject \"{subject}\" and body: \"{body}\". Should I send it? Reply yes or no.",
        }

    # Step 2: Confirmation received — actually send
    del _pending_sends[confirmation_id]

    token = await gmail_client._resolve_token(user_id, auth_token)
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(base_url=settings.phase_a_base_url, timeout=30) as client:
        resp = await client.post(
            "/api/gmail/send",
            json={"to": to, "subject": subject, "body": body, "confirm": True},
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()


async def confirm_latest_send(user_id: str, auth_token: str = "") -> dict:
    """Confirm and send the most recently pending email."""
    if not _pending_sends:
        return {"status": "error", "message": "No pending email to send. Draft one first."}

    # Get the most recent pending send
    confirmation_id = list(_pending_sends.keys())[-1]
    pending = _pending_sends.pop(confirmation_id)

    token = await gmail_client._resolve_token(user_id, auth_token)
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(base_url=settings.phase_a_base_url, timeout=30) as client:
        resp = await client.post(
            "/api/gmail/send",
            json={
                "to": pending["to"],
                "subject": pending["subject"],
                "body": pending["body"],
                "confirm": True,
            },
            headers=headers,
        )
        resp.raise_for_status()
        result = resp.json()

        if result.get("status") == "sent":
            return {
                "status": "sent",
                "tell_user": f"Email successfully sent to {pending['to']} with subject \"{pending['subject']}\".",
            }
        return result


async def agent_query(user_id: str, message: str, auth_token: str = "") -> str:
    """Free-form agent chat — fetches context and lets Ollama answer."""
    emails = await gmail_client.list_recent_emails(user_id, count=10, auth_token=auth_token)
    context = _emails_to_text(emails)
    return ollama_service.agent_chat(message, context=context)
