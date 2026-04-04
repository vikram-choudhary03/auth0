from pydantic import BaseModel


class EmailMeta(BaseModel):
    id: str
    sender: str
    subject: str
    snippet: str
    date: str


class EmailContent(BaseModel):
    id: str
    sender: str
    subject: str
    body: str
    date: str


class SummaryRequest(BaseModel):
    user_id: str
    query: str | None = None


class SummaryResponse(BaseModel):
    summary: str
    email_count: int


class DraftRequest(BaseModel):
    user_id: str
    email_id: str
    instruction: str | None = "Write a professional reply."


class DraftResponse(BaseModel):
    email_id: str
    subject: str
    draft_body: str


class AgentQuery(BaseModel):
    user_id: str
    message: str
