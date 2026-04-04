import os
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="Gmail Agent Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN", "")
AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE", "")
AUTH0_ISSUER = f"https://{AUTH0_DOMAIN}/"
AUTH0_ALGORITHMS = ["RS256"]

AUTH0_CUSTOM_API_CLIENT_ID = os.getenv("AUTH0_CUSTOM_API_CLIENT_ID", "")
AUTH0_CUSTOM_API_CLIENT_SECRET = os.getenv("AUTH0_CUSTOM_API_CLIENT_SECRET", "")
AUTH0_GOOGLE_CONNECTION = os.getenv("AUTH0_GOOGLE_CONNECTION", "google-oauth2")

GOOGLE_GMAIL_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
]

_jwks_cache: Optional[Dict[str, Any]] = None


class UserProfile(BaseModel):
    sub: str
    email: Optional[str] = None
    scope: Optional[str] = None
    permissions: Optional[List[str]] = None


class EmailItem(BaseModel):
    id: str
    threadId: str
    snippet: Optional[str] = None
    subject: Optional[str] = None
    from_: Optional[str] = None


class InboxResponse(BaseModel):
    messages: List[EmailItem]


class SummaryRequest(BaseModel):
    prompt: Optional[str] = None
    max_results: int = 5


class GmailProfile(BaseModel):
    emailAddress: str
    messagesTotal: Optional[int] = None
    threadsTotal: Optional[int] = None
    historyId: Optional[str] = None


def get_jwks() -> Dict[str, Any]:
    global _jwks_cache
    if _jwks_cache is None:
        url = f"https://{AUTH0_DOMAIN}/.well-known/jwks.json"
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        _jwks_cache = response.json()
    return _jwks_cache


def safe_json(response: requests.Response) -> Any:
    try:
        return response.json()
    except Exception:
        return response.text


def get_current_user(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    print("AUTH HEADER RECEIVED:", "present" if authorization else "missing")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    print("AUTH TOKEN PREFIX:", token[:25] + "..." if token else "empty")

    try:
        unverified_header = jwt.get_unverified_header(token)
        print("UNVERIFIED JWT HEADER:", unverified_header)
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token header") from exc

    jwks = get_jwks()
    rsa_key = None
    for key in jwks.get("keys", []):
        if key.get("kid") == unverified_header.get("kid"):
            rsa_key = {
                "kty": key["kty"],
                "kid": key["kid"],
                "use": key["use"],
                "n": key["n"],
                "e": key["e"],
            }
            break

    if not rsa_key:
        raise HTTPException(status_code=401, detail="Unable to find matching JWKS key")

    try:
        payload = jwt.decode(
            token,
            rsa_key,
            algorithms=AUTH0_ALGORITHMS,
            audience=AUTH0_AUDIENCE,
            issuer=AUTH0_ISSUER,
        )
        print("JWT PAYLOAD SUB:", payload.get("sub"))
        print("JWT PAYLOAD AUD:", payload.get("aud"))
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Token validation failed: {str(exc)}") from exc

    payload["raw_token"] = token
    return payload


_mgmt_token_cache: Optional[Dict[str, Any]] = None


def get_management_api_token() -> str:
    global _mgmt_token_cache
    import time

    if _mgmt_token_cache and _mgmt_token_cache.get("expires_at", 0) > time.time():
        return _mgmt_token_cache["access_token"]

    response = requests.post(
        f"https://{AUTH0_DOMAIN}/oauth/token",
        json={
            "grant_type": "client_credentials",
            "client_id": AUTH0_CUSTOM_API_CLIENT_ID,
            "client_secret": AUTH0_CUSTOM_API_CLIENT_SECRET,
            "audience": f"https://{AUTH0_DOMAIN}/api/v2/",
        },
        timeout=20,
    )
    if response.status_code >= 400:
        print("MGMT TOKEN ERROR:", response.status_code, safe_json(response))
        raise HTTPException(status_code=502, detail="Failed to get Management API token")
    data = response.json()
    _mgmt_token_cache = {
        "access_token": data["access_token"],
        "expires_at": time.time() + data.get("expires_in", 3600) - 60,
    }
    return data["access_token"]


def get_google_access_token_from_token_vault(auth0_user_access_token: str) -> str:
    """Get Google access token via Management API (reads from user identity)."""

    # First decode the JWT to get the user's sub
    unverified = jwt.get_unverified_claims(auth0_user_access_token)
    user_id = unverified.get("sub", "")

    if not user_id:
        raise HTTPException(status_code=400, detail="Cannot determine user ID from token")

    print(f"=== MGMT API: Fetching Google token for user {user_id} ===")

    mgmt_token = get_management_api_token()

    # Get user's identity with IdP tokens
    response = requests.get(
        f"https://{AUTH0_DOMAIN}/api/v2/users/{requests.utils.quote(user_id, safe='')}",
        headers={"Authorization": f"Bearer {mgmt_token}"},
        timeout=20,
    )

    if response.status_code >= 400:
        print("MGMT API ERROR:", safe_json(response))
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch user from Management API",
                "status": response.status_code,
                "response": safe_json(response),
            },
        )

    user_data = response.json()
    identities = user_data.get("identities", [])

    for identity in identities:
        if identity.get("connection") == AUTH0_GOOGLE_CONNECTION:
            access_token = identity.get("access_token")
            if access_token:
                print("=== MGMT API: Got Google access token ===")
                return access_token

    raise HTTPException(
        status_code=502,
        detail="No Google access token found in user identity",
    )


def normalize_headers(headers: List[Dict[str, str]]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for header in headers:
        name = (header.get("name") or "").strip().lower()
        value = (header.get("value") or "").strip()
        if name:
            out[name] = value
    return out


def get_gmail_profile(gmail_access_token: str) -> Dict[str, Any]:
    url = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
    headers = {"Authorization": f"Bearer {gmail_access_token}"}

    response = requests.get(url, headers=headers, timeout=20)
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch Gmail profile",
                "gmail_status": response.status_code,
                "gmail_response": safe_json(response),
            },
        )

    return response.json()


def get_message_detail(gmail_access_token: str, message_id: str) -> Dict[str, Any]:
    url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}"
    headers = {"Authorization": f"Bearer {gmail_access_token}"}
    params = {"format": "metadata", "metadataHeaders": ["From", "Subject"]}

    response = requests.get(url, headers=headers, params=params, timeout=20)
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail={
                "message": f"Failed to fetch Gmail message {message_id}",
                "gmail_status": response.status_code,
                "gmail_response": safe_json(response),
            },
        )

    return response.json()


def list_recent_messages(gmail_access_token: str, max_results: int = 5) -> List[EmailItem]:
    list_url = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
    headers = {"Authorization": f"Bearer {gmail_access_token}"}
    params = {"maxResults": max_results}

    response = requests.get(list_url, headers=headers, params=params, timeout=20)
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch Gmail messages",
                "gmail_status": response.status_code,
                "gmail_response": safe_json(response),
            },
        )

    data = response.json()
    raw_messages = data.get("messages", [])
    output: List[EmailItem] = []

    for item in raw_messages:
        message_id = item["id"]
        detail = get_message_detail(gmail_access_token, message_id)
        headers_map = normalize_headers(detail.get("payload", {}).get("headers", []))
        output.append(
            EmailItem(
                id=detail.get("id"),
                threadId=detail.get("threadId"),
                snippet=detail.get("snippet"),
                subject=headers_map.get("subject"),
                from_=headers_map.get("from"),
            )
        )

    return output


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/me", response_model=UserProfile)
def me(user: Dict[str, Any] = Depends(get_current_user)) -> UserProfile:
    return UserProfile(
        sub=user.get("sub"),
        email=user.get("email"),
        scope=user.get("scope"),
        permissions=user.get("permissions"),
    )


@app.get("/api/gmail/profile", response_model=GmailProfile)
def gmail_profile(user: Dict[str, Any] = Depends(get_current_user)) -> GmailProfile:
    auth0_access_token = user["raw_token"]
    gmail_access_token = get_google_access_token_from_token_vault(auth0_access_token)
    profile = get_gmail_profile(gmail_access_token)

    return GmailProfile(
        emailAddress=profile.get("emailAddress", ""),
        messagesTotal=profile.get("messagesTotal"),
        threadsTotal=profile.get("threadsTotal"),
        historyId=profile.get("historyId"),
    )


@app.get("/api/gmail/recent", response_model=InboxResponse)
def gmail_recent(
    max_results: int = 5,
    user: Dict[str, Any] = Depends(get_current_user),
) -> InboxResponse:
    if max_results < 1 or max_results > 20:
        raise HTTPException(status_code=400, detail="max_results must be between 1 and 20")

    auth0_access_token = user["raw_token"]
    gmail_access_token = get_google_access_token_from_token_vault(auth0_access_token)
    messages = list_recent_messages(gmail_access_token, max_results=max_results)
    return InboxResponse(messages=messages)


# ── Adapter endpoints for Phase B Agent Service ──


@app.get("/api/gmail/messages")
def gmail_messages(
    user_id: str = "",
    count: int = 10,
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    """List emails in format Phase B agent service expects."""
    count = min(max(count, 1), 20)
    auth0_access_token = user["raw_token"]
    gmail_access_token = get_google_access_token_from_token_vault(auth0_access_token)
    messages = list_recent_messages(gmail_access_token, max_results=count)

    return [
        {
            "id": m.id,
            "sender": m.from_ or "Unknown",
            "subject": m.subject or "(No subject)",
            "snippet": m.snippet or "",
            "date": "",
        }
        for m in messages
    ]


@app.get("/api/gmail/messages/{message_id}")
def gmail_message_detail_endpoint(
    message_id: str,
    user_id: str = "",
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Get full email content in format Phase B agent service expects."""
    import base64

    auth0_access_token = user["raw_token"]
    gmail_access_token = get_google_access_token_from_token_vault(auth0_access_token)

    url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}"
    headers_req = {"Authorization": f"Bearer {gmail_access_token}"}
    response = requests.get(url, headers=headers_req, params={"format": "full"}, timeout=20)

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Failed to fetch email")

    detail = response.json()
    headers_map = normalize_headers(detail.get("payload", {}).get("headers", []))

    body = ""
    payload_data = detail.get("payload", {})
    if payload_data.get("body", {}).get("data"):
        body = base64.urlsafe_b64decode(payload_data["body"]["data"]).decode("utf-8", errors="replace")
    elif payload_data.get("parts"):
        for part in payload_data["parts"]:
            if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
                body = base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
                break

    return {
        "id": detail.get("id", message_id),
        "sender": headers_map.get("from", "Unknown"),
        "subject": headers_map.get("subject", "(No subject)"),
        "body": body or detail.get("snippet", ""),
        "date": headers_map.get("date", ""),
    }


@app.post("/api/gmail/summarize")
def gmail_summarize(
    payload: SummaryRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    auth0_access_token = user["raw_token"]
    gmail_access_token = get_google_access_token_from_token_vault(auth0_access_token)
    messages = list_recent_messages(gmail_access_token, max_results=payload.max_results)

    compact = [
        {
            "from": m.from_,
            "subject": m.subject,
            "snippet": m.snippet,
        }
        for m in messages
    ]

    return {
        "summary": "Phase 1 stub: Auth0 + Token Vault + Gmail access is working. Plug Ollama here next.",
        "emails": compact,
        "prompt_received": payload.prompt,
    }