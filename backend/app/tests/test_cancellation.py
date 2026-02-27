"""
Tests for cancellation propagation to URL tasks and browser sessions.
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.browsing.agent_browser_cli import AgentBrowserSession
from app.browsing.session_manager import BrowserSessionManager


class TestAgentBrowserCancellation:
    @pytest.mark.asyncio
    async def test_session_close_cleans_up(self):
        session = AgentBrowserSession(session_id="test-cancel")
        session._use_cli = False
        await session.open("https://example.com")
        await session.close()
        assert session._closed is True

    @pytest.mark.asyncio
    async def test_double_close_is_safe(self):
        session = AgentBrowserSession(session_id="test-dbl")
        session._use_cli = False
        await session.close()
        await session.close()  # should not raise

    @pytest.mark.asyncio
    async def test_fallback_extract_works(self):
        session = AgentBrowserSession(session_id="test-fb")
        session._use_cli = False
        session._current_url = "https://example.com"
        result = await session.extract_main_text(max_chars=500)
        assert result.url == "https://example.com"


class TestBrowserSessionManager:
    @pytest.mark.asyncio
    async def test_create_and_close(self):
        mgr = BrowserSessionManager(max_sessions=5)
        session = await mgr.create(session_id="test1")
        assert mgr.active_count == 1
        await mgr.close("test1")
        assert mgr.active_count == 0

    @pytest.mark.asyncio
    async def test_max_sessions_enforced(self):
        mgr = BrowserSessionManager(max_sessions=2, idle_ttl=1)
        await mgr.create(session_id="s1")
        await mgr.create(session_id="s2")
        s3 = await mgr.create(session_id="s3")
        assert mgr.active_count <= 2

    @pytest.mark.asyncio
    async def test_cleanup_idle(self):
        mgr = BrowserSessionManager(max_sessions=5, idle_ttl=0)
        await mgr.create(session_id="idle1")
        await asyncio.sleep(0.1)
        cleaned = await mgr.cleanup_idle(ttl=0)
        assert cleaned >= 1

    @pytest.mark.asyncio
    async def test_close_all(self):
        mgr = BrowserSessionManager(max_sessions=5)
        await mgr.create(session_id="a1")
        await mgr.create(session_id="a2")
        await mgr.close_all()
        assert mgr.active_count == 0

    @pytest.mark.asyncio
    async def test_get_existing_session(self):
        mgr = BrowserSessionManager(max_sessions=5)
        created = await mgr.create(session_id="get-test")
        retrieved = await mgr.get("get-test")
        assert retrieved is not None
        assert retrieved.session_id == "get-test"
        await mgr.close_all()

    @pytest.mark.asyncio
    async def test_get_nonexistent_session(self):
        mgr = BrowserSessionManager(max_sessions=5)
        result = await mgr.get("nonexistent")
        assert result is None
