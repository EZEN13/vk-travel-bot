"""
Configuration module for the Telegram AI Consultant Bot.
Loads environment variables and provides application settings.
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Application configuration settings."""

    # Telegram settings
    TELEGRAM_TOKEN: str = os.getenv("TELEGRAM_TOKEN", "")

    # OpenAI settings
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    OPENAI_MAX_TOKENS: int = int(os.getenv("OPENAI_MAX_TOKENS", "1000"))
    OPENAI_TEMPERATURE: float = float(os.getenv("OPENAI_TEMPERATURE", "0.7"))

    # Memory settings
    MEMORY_LIMIT: int = int(os.getenv("MEMORY_LIMIT", "15"))

    # Database settings
    DATABASE_PATH: str = os.getenv("DATABASE_PATH", "database/bot.db")

    @classmethod
    def validate(cls) -> bool:
        """Validate required configuration values."""
        errors = []

        if not cls.TELEGRAM_TOKEN:
            errors.append("TELEGRAM_TOKEN is not set")

        if not cls.OPENAI_API_KEY:
            errors.append("OPENAI_API_KEY is not set")

        if errors:
            for error in errors:
                print(f"Configuration Error: {error}")
            return False

        return True


config = Config()
