"""
BrowserSessionManager — manages lifecycle of AgentBrowserSession instances.

Provides:
  - create / get / close individual sessions
  - cleanup_idle(ttl) to reap stale sessions
  - max concurrent session enforcement
  - cancel closes all subprocesses
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from app.browsing.agent_browser_cli import AgentBrowserSession

logger = logging.getLogger(__name__)

DEFAULT_MAX_SESSIONS = 10
DEFAULT_IDLE_TTL = 300  # 5 minutes


class BrowserSessionManager:
    """Thread-safe manager for AgentBrowserSession instances."""

    def __init__(
        self,
        max_sessions: int = DEFAULT_MAX_SESSIONS,
        idle_ttl: int = DEFAULT_IDLE_TTL,
    ):
        self._sessions: dict[str, AgentBrowserSession] = {}
        self._last_active: dict[str, float] = {}
        self._max_sessions = max_sessions
        self._idle_ttl = idle_ttl
        self._lock = asyncio.Lock()

    async def create(self, session_id: str | None = None, timeout: int = 30) -> AgentBrowserSession:
        """Create a new browser session, enforcing max-concurrent limit."""
        evict_session = None
        async with self._lock:
            if len(self._sessions) >= self._max_sessions:
                if self._last_active:
                    oldest_sid = min(self._last_active, key=self._last_active.get)
                    evict_session = self._sessions.pop(oldest_sid, None)
                    self._last_active.pop(oldest_sid, None)

            if len(self._sessions) >= self._max_sessions:
                raise RuntimeError(
                    f"Max concurrent sessions ({self._max_sessions}) reached"
                )

            session = AgentBrowserSession(session_id=session_id, timeout=timeout)
            self._sessions[session.session_id] = session
            self._last_active[session.session_id] = time.time()

        if evict_session:
            await evict_session.close()

        logger.info("Browser session created: %s", session.session_id)
        return session

    async def get(self, session_id: str) -> Optional[AgentBrowserSession]:
        """Retrieve an existing session, updating its activity timestamp."""
        session = self._sessions.get(session_id)
        if session:
            self._last_active[session_id] = time.time()
        return session

    async def close(self, session_id: str) -> None:
        """Close and remove a specific session (safe to call externally)."""
        session: Optional[AgentBrowserSession] = None
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            self._last_active.pop(session_id, None)
        if session:
            await session.close()
            logger.info("Browser session closed: %s", session_id)

    async def cleanup_idle(self, ttl: int | None = None) -> int:
        """Close sessions idle longer than TTL. Returns count of sessions closed."""
        cutoff = time.time() - (ttl or self._idle_ttl)
        to_close: list[tuple[str, AgentBrowserSession]] = []

        async with self._lock:
            stale_ids = [
                sid for sid, ts in self._last_active.items()
                if ts < cutoff
            ]
            for sid in stale_ids:
                session = self._sessions.pop(sid, None)
                self._last_active.pop(sid, None)
                if session:
                    to_close.append((sid, session))

        for sid, session in to_close:
            await session.close()

        return len(to_close)

    async def close_all(self) -> None:
        """Shut down all sessions. Call on application shutdown."""
        to_close: list[AgentBrowserSession] = []
        async with self._lock:
            to_close = list(self._sessions.values())
            self._sessions.clear()
            self._last_active.clear()

        for session in to_close:
            await session.close()
        logger.info("All browser sessions closed")

    @property
    def active_count(self) -> int:
        return len(self._sessions)
