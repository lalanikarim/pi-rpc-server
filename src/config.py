"""Configuration management for Pi RPC server."""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml
from dotenv import load_dotenv


@dataclass
class PiAgentConfig:
    """Configuration for pi coding agent."""

    api_key: Optional[str] = None
    provider: str = "anthropic"
    model: str = "claude-sonnet-4-20250514"
    thinking_level: str = "medium"
    session_dir: Optional[str] = None
    no_session: bool = False


@dataclass
class ServerConfig:
    """Server configuration."""

    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = 4
    cors_origins: list[str] = None

    def __post_init__(self):
        if self.cors_origins is None:
            self.cors_origins = []


@dataclass
class AppConfig:
    """Main application configuration."""

    pi: PiAgentConfig
    server: ServerConfig


def load_env() -> None:
    """Load environment variables from .env file."""
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)


def load_extensions_config() -> dict:
    """Load extensions configuration from YAML file."""
    extensions_path = Path(__file__).parent.parent / ".pi" / "extensions.yaml"
    if extensions_path.exists():
        with open(extensions_path, "r") as f:
            return yaml.safe_load(f) or {}
    return {}


def create_config() -> AppConfig:
    """Create application configuration from environment variables."""
    pi_config = PiAgentConfig(
        api_key=os.environ.get("PI_API_KEY"),
        provider=os.environ.get("PI_PROVIDER", "anthropic"),
        model=os.environ.get("PI_MODEL", "claude-sonnet-4-20250514"),
        thinking_level=os.environ.get("PI_THINKING_LEVEL", "medium"),
        session_dir=os.environ.get("PI_SESSION_DIR"),
        no_session=os.environ.get("PI_NO_SESSION", "false").lower() == "true",
    )

    cors_str = os.environ.get("CORS_ORIGINS", "*")
    cors_origins = (
        [origin.strip() for origin in cors_str.split(",")] if cors_str != "*" else ["*"]
    )

    server_config = ServerConfig(
        host=os.environ.get("SERVER_HOST", "0.0.0.0"),
        port=int(os.environ.get("SERVER_PORT", "8000")),
        workers=int(os.environ.get("MAX_WORKERS", "4")),
        cors_origins=cors_origins,
    )

    return AppConfig(pi=pi_config, server=server_config)
