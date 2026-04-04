"""Mock Phase A server — serves fake Gmail data on port 8000."""

from fastapi import FastAPI
import uvicorn

app = FastAPI(title="Mock Phase A (Gmail via Auth0)")

EMAILS = [
    {
        "id": "msg_001",
        "sender": "alice@example.com",
        "subject": "Urgent: Server outage in production",
        "snippet": "Hey team, we have a critical issue with the prod servers...",
        "date": "2026-04-03T09:15:00Z",
    },
    {
        "id": "msg_002",
        "sender": "bob@company.com",
        "subject": "Q2 Planning Meeting - Thursday",
        "snippet": "Reminder that our Q2 planning session is this Thursday at 2pm...",
        "date": "2026-04-03T08:30:00Z",
    },
    {
        "id": "msg_003",
        "sender": "newsletter@techdigest.io",
        "subject": "Your weekly tech roundup",
        "snippet": "This week in tech: AI breakthroughs, new framework releases...",
        "date": "2026-04-02T18:00:00Z",
    },
    {
        "id": "msg_004",
        "sender": "manager@company.com",
        "subject": "Re: Performance review feedback",
        "snippet": "Thanks for submitting your self-review. I'd like to schedule a 1:1...",
        "date": "2026-04-02T14:22:00Z",
    },
    {
        "id": "msg_005",
        "sender": "noreply@spam-offers.com",
        "subject": "You've won a FREE cruise!!!",
        "snippet": "Congratulations! You have been selected for an exclusive offer...",
        "date": "2026-04-01T10:00:00Z",
    },
]

BODIES = {
    "msg_001": "Hey team,\n\nWe have a critical issue with the prod servers. The API gateway is returning 502 errors for about 30% of requests. The database connection pool is exhausted.\n\nCan someone from infra look into this ASAP?\n\nThanks,\nAlice",
    "msg_002": "Hi all,\n\nReminder that our Q2 planning session is this Thursday at 2pm in Conference Room B.\n\nAgenda:\n1. Q1 retrospective\n2. Q2 OKRs\n3. Resource allocation\n4. Open discussion\n\nBest,\nBob",
    "msg_003": "This week in tech:\n\n- New AI model achieves SOTA on reasoning benchmarks\n- React 21 released with server components by default\n- Python 3.15 beta available\n\nRead more at techdigest.io",
    "msg_004": "Hi,\n\nThanks for submitting your self-review. I'd like to schedule a 1:1 to discuss your goals for next quarter. Are you free Friday afternoon?\n\nBest,\nYour Manager",
    "msg_005": "Congratulations! You have been selected for an exclusive FREE cruise to the Bahamas! Click here to claim your prize NOW! Limited time offer!!!",
}


@app.get("/api/gmail/messages")
async def list_messages(user_id: str, count: int = 10):
    return EMAILS[:count]


@app.get("/api/gmail/messages/{message_id}")
async def get_message(message_id: str, user_id: str):
    for e in EMAILS:
        if e["id"] == message_id:
            return {**e, "body": BODIES.get(message_id, "No body available.")}
    return {"error": "not found"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
