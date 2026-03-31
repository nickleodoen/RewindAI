"""Application settings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "rewindai"
    anthropic_api_key: str = ""
    compaction_threshold: int = 5000

    class Config:
        env_file = ".env"
