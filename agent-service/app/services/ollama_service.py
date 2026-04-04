"""
Ollama service — local LLM inference for summarization, classification, and drafting.
"""

import ollama as ollama_client

from app.config import settings


def _chat(prompt: str, system: str = "", model: str | None = None) -> str:
    response = ollama_client.chat(
        model=model or settings.ollama_summarize_model,
        messages=[
            *([] if not system else [{"role": "system", "content": system}]),
            {"role": "user", "content": prompt},
        ],
        options={"temperature": 0.3},
    )
    return response["message"]["content"]


def summarize_emails(emails_text: str, query: str | None = None) -> str:
    system = (
        "You are an email assistant. Summarize emails concisely. "
        "Use bullet points. Highlight urgent items first."
    )
    prompt = f"Here are the recent emails:\n\n{emails_text}"
    if query:
        prompt += f"\n\nUser's specific question: {query}"
    return _chat(prompt, system=system)


def classify_emails(emails_text: str) -> str:
    system = (
        "You are an email classifier. Categorize each email as one of: "
        "urgent, needs-reply, informational, spam. Output a short table."
    )
    return _chat(f"Classify these emails:\n\n{emails_text}", system=system)


def draft_reply(email_body: str, subject: str, instruction: str) -> str:
    system = (
        "You are a professional email writer. Draft a reply based on the "
        "user's instruction. Be concise and professional. "
        "Output ONLY the reply body, no subject line."
    )
    prompt = (
        f"Original email subject: {subject}\n\n"
        f"Original email body:\n{email_body}\n\n"
        f"User instruction: {instruction}"
    )
    return _chat(prompt, system=system)


def agent_chat(message: str, context: str = "") -> str:
    system = (
        "You are a helpful Gmail assistant agent. You help users understand "
        "and manage their email. You can summarize emails, find important ones, "
        "classify them, and draft replies. Be concise and helpful."
    )
    prompt = message
    if context:
        prompt = f"Context (recent emails):\n{context}\n\nUser: {message}"
    return _chat(prompt, system=system)
