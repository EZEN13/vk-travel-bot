"""
Database module for SQLite operations.
Handles message storage for short-term memory.
"""

import aiosqlite
import os
from datetime import datetime
from typing import Optional

from config import config


class Database:
    """SQLite database handler for message storage."""

    def __init__(self, db_path: Optional[str] = None):
        """Initialize database with path."""
        self.db_path = db_path or config.DATABASE_PATH
        self._connection: Optional[aiosqlite.Connection] = None

    async def connect(self) -> None:
        """Establish database connection and create tables."""
        # Ensure database directory exists
        db_dir = os.path.dirname(self.db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir)

        self._connection = await aiosqlite.connect(self.db_path)
        await self._create_tables()

    async def _create_tables(self) -> None:
        """Create required database tables."""
        if not self._connection:
            raise RuntimeError("Database not connected")

        await self._connection.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Create index for faster user_id lookups
        await self._connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_user_id
            ON messages(user_id)
        """)

        # Create index for timestamp-based queries
        await self._connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp
            ON messages(user_id, timestamp DESC)
        """)

        await self._connection.commit()

    async def disconnect(self) -> None:
        """Close database connection."""
        if self._connection:
            await self._connection.close()
            self._connection = None

    async def save_message(
        self, user_id: int, role: str, content: str
    ) -> int:
        """
        Save a message to the database.

        Args:
            user_id: Telegram user ID
            role: Message role ('user' or 'assistant')
            content: Message content

        Returns:
            ID of the inserted message
        """
        if not self._connection:
            raise RuntimeError("Database not connected")

        cursor = await self._connection.execute(
            """
            INSERT INTO messages (user_id, role, content, timestamp)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, role, content, datetime.utcnow().isoformat()),
        )
        await self._connection.commit()
        return cursor.lastrowid or 0

    async def get_last_messages(
        self, user_id: int, limit: int = 15
    ) -> list[dict]:
        """
        Get the last N messages for a user.

        Args:
            user_id: Telegram user ID
            limit: Maximum number of messages to retrieve

        Returns:
            List of message dictionaries with role and content
        """
        if not self._connection:
            raise RuntimeError("Database not connected")

        cursor = await self._connection.execute(
            """
            SELECT role, content, timestamp
            FROM messages
            WHERE user_id = ?
            ORDER BY timestamp DESC, id DESC
            LIMIT ?
            """,
            (user_id, limit),
        )

        rows = await cursor.fetchall()

        # Reverse to get chronological order
        messages = [
            {"role": row[0], "content": row[1], "timestamp": row[2]}
            for row in reversed(rows)
        ]

        return messages

    async def clear_user_history(self, user_id: int) -> int:
        """
        Clear all messages for a specific user.

        Args:
            user_id: Telegram user ID

        Returns:
            Number of deleted messages
        """
        if not self._connection:
            raise RuntimeError("Database not connected")

        cursor = await self._connection.execute(
            "DELETE FROM messages WHERE user_id = ?",
            (user_id,),
        )
        await self._connection.commit()
        return cursor.rowcount

    async def get_message_count(self, user_id: int) -> int:
        """
        Get the total number of messages for a user.

        Args:
            user_id: Telegram user ID

        Returns:
            Message count
        """
        if not self._connection:
            raise RuntimeError("Database not connected")

        cursor = await self._connection.execute(
            "SELECT COUNT(*) FROM messages WHERE user_id = ?",
            (user_id,),
        )
        row = await cursor.fetchone()
        return row[0] if row else 0


# Global database instance
db = Database()
