from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    project_id: str = "acp-hackathon-2026-505906"
    region: str = "us"
    model: str = "gemini-3.5-flash"
    vertex_base_url: str = "https://aiplatform.us.rep.googleapis.com"
    google_client_id: str = ""
    admin_emails: str = ""
    frontend_origin: str = "http://localhost:3000"
    rate_limit_backend: str = "memory"

    model_config = SettingsConfigDict(env_file=Path(__file__).with_name(".env"), extra="ignore")


settings = Settings()
