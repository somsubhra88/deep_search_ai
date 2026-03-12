"""
User authentication database with secure password storage.
"""

import base64
import json
import os
import sqlite3
import uuid
from cryptography.fernet import Fernet
from datetime import datetime, timezone
from typing import Optional

import pathlib


def _resolve_auth_db_path() -> pathlib.Path:
    """Find a writable location for the auth DB."""
    base = pathlib.Path(__file__).resolve()
    candidates = [
        base.parents[2] / "data" / "auth.db",   # local repo
        base.parents[1] / "data" / "auth.db",    # docker
    ]
    for p in candidates:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            return p
        except PermissionError:
            continue
    return candidates[-1]


AUTH_DB_PATH = _resolve_auth_db_path()

# Encryption key for API keys - stored in environment or generated
_ENCRYPTION_KEY = os.getenv("API_KEY_ENCRYPTION_KEY")
if not _ENCRYPTION_KEY:
    # Generate a key if not set (store this in .env for production!)
    _ENCRYPTION_KEY = Fernet.generate_key().decode()
_fernet = Fernet(_ENCRYPTION_KEY.encode() if isinstance(_ENCRYPTION_KEY, str) else _ENCRYPTION_KEY)


def _encrypt_api_key(api_key: str) -> str:
    """Encrypt an API key for storage."""
    return _fernet.encrypt(api_key.encode()).decode()


def _decrypt_api_key(encrypted_key: str) -> str:
    """Decrypt an API key from storage."""
    return _fernet.decrypt(encrypted_key.encode()).decode()


def _get_connection() -> sqlite3.Connection:
    AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(AUTH_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_auth_db() -> None:
    """Initialize authentication database tables."""
    conn = _get_connection()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        last_login TEXT,
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_activity TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        is_valid INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON user_sessions(token_hash);

    CREATE TABLE IF NOT EXISTS search_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        search_id TEXT NOT NULL,
        query TEXT NOT NULL,
        mode TEXT NOT NULL,
        provider_config TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed'
    );

    CREATE INDEX IF NOT EXISTS idx_history_user_id ON search_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_history_search_id ON search_history(search_id);

    CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        theme TEXT DEFAULT 'system',
        default_provider TEXT,
        settings TEXT
    );

    CREATE TABLE IF NOT EXISTS user_api_keys (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, provider)
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON user_api_keys(user_id);
    """)
    conn.commit()
    conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_user(username: str, email: str, password_hash: str) -> str:
    """Create a new user and return user_id."""
    user_id = uuid.uuid4().hex
    conn = _get_connection()
    now = _now()
    try:
        conn.execute(
            "INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (user_id, username, email, password_hash, now, now),
        )
        conn.commit()
        return user_id
    except sqlite3.IntegrityError as e:
        raise ValueError(f"User already exists: {e}")
    finally:
        conn.close()


def get_user_by_username(username: str) -> Optional[dict]:
    """Get user by username."""
    conn = _get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_email(email: str) -> Optional[dict]:
    """Get user by email."""
    conn = _get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_id(user_id: str) -> Optional[dict]:
    """Get user by ID."""
    conn = _get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def update_last_login(user_id: str) -> None:
    """Update user's last login timestamp and reset failed attempts."""
    conn = _get_connection()
    try:
        conn.execute(
            "UPDATE users SET last_login=?, failed_login_attempts=0, locked_until=NULL, updated_at=? WHERE id=?",
            (_now(), _now(), user_id),
        )
        conn.commit()
    finally:
        conn.close()


def increment_failed_login(user_id: str, lock_duration_minutes: int = 15) -> None:
    """Increment failed login attempts and lock account if needed."""
    conn = _get_connection()
    try:
        user = conn.execute("SELECT failed_login_attempts FROM users WHERE id=?", (user_id,)).fetchone()
        if user:
            attempts = user["failed_login_attempts"] + 1
            locked_until = None
            if attempts >= 5:  # Lock after 5 failed attempts
                from datetime import timedelta
                locked_until = (datetime.now(timezone.utc) + timedelta(minutes=lock_duration_minutes)).isoformat()
            conn.execute(
                "UPDATE users SET failed_login_attempts=?, locked_until=?, updated_at=? WHERE id=?",
                (attempts, locked_until, _now(), user_id),
            )
            conn.commit()
    finally:
        conn.close()


def is_user_locked(user_id: str) -> bool:
    """Check if user account is locked."""
    conn = _get_connection()
    try:
        row = conn.execute("SELECT locked_until FROM users WHERE id=?", (user_id,)).fetchone()
        if row and row["locked_until"]:
            locked_until = datetime.fromisoformat(row["locked_until"])
            if datetime.now(timezone.utc) < locked_until:
                return True
            # Unlock if time has passed
            conn.execute("UPDATE users SET locked_until=NULL WHERE id=?", (user_id,))
            conn.commit()
        return False
    finally:
        conn.close()


def create_session(user_id: str, token_hash: str, expires_at: str, ip_address: Optional[str] = None, user_agent: Optional[str] = None) -> str:
    """Create a new user session."""
    session_id = uuid.uuid4().hex
    conn = _get_connection()
    try:
        now = _now()
        conn.execute(
            "INSERT INTO user_sessions (id, user_id, token_hash, created_at, expires_at, last_activity, ip_address, user_agent) VALUES (?,?,?,?,?,?,?,?)",
            (session_id, user_id, token_hash, now, expires_at, now, ip_address, user_agent),
        )
        conn.commit()
        return session_id
    finally:
        conn.close()


def get_session_by_token(token_hash: str) -> Optional[dict]:
    """Get session by token hash."""
    conn = _get_connection()
    try:
        row = conn.execute("SELECT * FROM user_sessions WHERE token_hash=? AND is_valid=1", (token_hash,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def invalidate_session(token_hash: str) -> None:
    """Invalidate a user session."""
    conn = _get_connection()
    try:
        conn.execute("UPDATE user_sessions SET is_valid=0 WHERE token_hash=?", (token_hash,))
        conn.commit()
    finally:
        conn.close()


def update_session_activity(session_id: str) -> None:
    """Update session last activity timestamp."""
    conn = _get_connection()
    try:
        conn.execute("UPDATE user_sessions SET last_activity=? WHERE id=?", (_now(), session_id))
        conn.commit()
    finally:
        conn.close()


def add_search_to_history(user_id: str, search_id: str, query: str, mode: str, provider_config: Optional[dict] = None) -> str:
    """Add a search to user's history."""
    history_id = uuid.uuid4().hex
    conn = _get_connection()
    try:
        conn.execute(
            "INSERT INTO search_history (id, user_id, search_id, query, mode, provider_config, created_at) VALUES (?,?,?,?,?,?,?)",
            (history_id, user_id, search_id, query, mode, json.dumps(provider_config) if provider_config else None, _now()),
        )
        conn.commit()
        return history_id
    finally:
        conn.close()


def get_user_search_history(user_id: str, limit: int = 50) -> list[dict]:
    """Get user's search history."""
    conn = _get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM search_history WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def get_user_preferences(user_id: str) -> Optional[dict]:
    """Get user preferences."""
    conn = _get_connection()
    try:
        row = conn.execute("SELECT * FROM user_preferences WHERE user_id=?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def update_user_preferences(user_id: str, theme: Optional[str] = None, default_provider: Optional[str] = None, settings: Optional[dict] = None) -> None:
    """Update user preferences."""
    conn = _get_connection()
    try:
        # Insert or update
        existing = conn.execute("SELECT user_id FROM user_preferences WHERE user_id=?", (user_id,)).fetchone()
        if existing:
            set_parts = []
            values = []
            if theme is not None:
                set_parts.append("theme=?")
                values.append(theme)
            if default_provider is not None:
                set_parts.append("default_provider=?")
                values.append(default_provider)
            if settings is not None:
                set_parts.append("settings=?")
                values.append(json.dumps(settings))
            if set_parts:
                values.append(user_id)
                conn.execute(f"UPDATE user_preferences SET {', '.join(set_parts)} WHERE user_id=?", tuple(values))
        else:
            conn.execute(
                "INSERT INTO user_preferences (user_id, theme, default_provider, settings) VALUES (?,?,?,?)",
                (user_id, theme, default_provider, json.dumps(settings) if settings else None),
            )
        conn.commit()
    finally:
        conn.close()


def save_user_api_key(user_id: str, provider: str, api_key: str) -> None:
    """Save or update user's API key for a provider (encrypted)."""
    conn = _get_connection()
    try:
        encrypted = _encrypt_api_key(api_key)
        now = _now()

        # Insert or replace
        existing = conn.execute(
            "SELECT user_id FROM user_api_keys WHERE user_id=? AND provider=?",
            (user_id, provider),
        ).fetchone()

        if existing:
            conn.execute(
                "UPDATE user_api_keys SET encrypted_key=?, updated_at=? WHERE user_id=? AND provider=?",
                (encrypted, now, user_id, provider),
            )
        else:
            conn.execute(
                "INSERT INTO user_api_keys (user_id, provider, encrypted_key, created_at, updated_at) VALUES (?,?,?,?,?)",
                (user_id, provider, encrypted, now, now),
            )
        conn.commit()
    finally:
        conn.close()


def get_user_api_key(user_id: str, provider: str) -> Optional[str]:
    """Get user's API key for a provider (decrypted)."""
    conn = _get_connection()
    try:
        row = conn.execute(
            "SELECT encrypted_key FROM user_api_keys WHERE user_id=? AND provider=?",
            (user_id, provider),
        ).fetchone()

        if row:
            return _decrypt_api_key(row["encrypted_key"])
        return None
    finally:
        conn.close()


def get_user_api_keys(user_id: str) -> dict[str, str]:
    """Get all API keys for a user (decrypted)."""
    conn = _get_connection()
    try:
        rows = conn.execute(
            "SELECT provider, encrypted_key FROM user_api_keys WHERE user_id=?",
            (user_id,),
        ).fetchall()

        return {
            row["provider"]: _decrypt_api_key(row["encrypted_key"])
            for row in rows
        }
    finally:
        conn.close()


def delete_user_api_key(user_id: str, provider: str) -> None:
    """Delete user's API key for a provider."""
    conn = _get_connection()
    try:
        conn.execute(
            "DELETE FROM user_api_keys WHERE user_id=? AND provider=?",
            (user_id, provider),
        )
        conn.commit()
    finally:
        conn.close()


def list_user_providers(user_id: str) -> list[str]:
    """List providers for which user has saved API keys."""
    conn = _get_connection()
    try:
        rows = conn.execute(
            "SELECT provider FROM user_api_keys WHERE user_id=?",
            (user_id,),
        ).fetchall()
        return [row["provider"] for row in rows]
    finally:
        conn.close()
