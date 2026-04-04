from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Phase A backend URL (Gmail endpoints)
    phase_a_base_url: str = "http://localhost:8000"

    # Ollama
    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "qwen3:4b"
    ollama_summarize_model: str = "qwen3:4b"

    # Agent service
    agent_port: int = 8001

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
