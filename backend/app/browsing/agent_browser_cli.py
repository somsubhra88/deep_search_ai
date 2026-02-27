"""
AgentBrowser wrapper — uses asyncio subprocesses to drive a headless browser
via the agent-browser CLI for snapshot + element-ref based browsing.

Provides session isolation with per-session work directories under
/tmp/agent_browser/<session_id>.

Falls back gracefully to httpx + BeautifulSoup when agent-browser is not
installed, so the evidence pipeline always works.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from app.schemas.evidence import (
    ExtractedContent,
    InteractiveElement,
    PageSnapshot,
    MAX_EXTRACTED_TEXT_CHARS,
    MAX_INTERACTIVE_ELEMENTS,
)

logger = logging.getLogger(__name__)

_BASE_WORKDIR = Path(os.getenv("AGENT_BROWSER_WORKDIR", "/tmp/agent_browser"))
_DEFAULT_TIMEOUT = int(os.getenv("AGENT_BROWSER_TIMEOUT", "30"))
_MAX_STEPS = int(os.getenv("AGENT_BROWSER_MAX_STEPS", "20"))
_ssl_verify = os.getenv("SSL_VERIFY", "true").lower() not in ("0", "false", "no")

CONSENT_KEYWORDS = [
    "accept all", "accept cookies", "i agree", "got it",
    "allow all", "consent", "agree and continue",
]


class AgentBrowserSession:
    """
    Wraps a single browsing session. Uses agent-browser CLI if available,
    otherwise falls back to httpx scraping.
    """

    def __init__(self, session_id: str | None = None, timeout: int = _DEFAULT_TIMEOUT):
        self.session_id = session_id or uuid.uuid4().hex[:12]
        self.workdir = _BASE_WORKDIR / self.session_id
        self.timeout = timeout
        self._step_count = 0
        self._process: Optional[asyncio.subprocess.Process] = None
        self._closed = False
        self._use_cli = shutil.which("npx") is not None
        self._current_url: str = ""

    async def _ensure_workdir(self) -> None:
        self.workdir.mkdir(parents=True, exist_ok=True)

    async def _run_cli(self, *args: str) -> str:
        """Run an agent-browser CLI command with timeout and cancellation."""
        if self._step_count >= _MAX_STEPS:
            raise RuntimeError(f"Max steps ({_MAX_STEPS}) exceeded for session {self.session_id}")
        self._step_count += 1

        await self._ensure_workdir()

        cmd = ["npx", "@anthropic-ai/agent-browser", *args]
        try:
            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.workdir),
            )
            stdout, stderr = await asyncio.wait_for(
                self._process.communicate(),
                timeout=self.timeout,
            )
            if self._process.returncode != 0:
                err_msg = stderr.decode(errors="replace")[:500]
                logger.warning("agent-browser CLI error: %s", err_msg)
                return ""
            return stdout.decode(errors="replace")
        except asyncio.TimeoutError:
            await self._kill_process()
            raise TimeoutError(f"agent-browser timed out after {self.timeout}s")
        except FileNotFoundError:
            self._use_cli = False
            return ""

    async def _kill_process(self) -> None:
        if self._process and self._process.returncode is None:
            try:
                self._process.kill()
                await self._process.wait()
            except ProcessLookupError:
                pass

    async def open(self, url: str) -> bool:
        """Navigate to URL. Returns True on success."""
        self._current_url = url
        if not self._use_cli:
            return True

        output = await self._run_cli("open", url)
        return bool(output)

    async def snapshot(self, interactive_only: bool = True) -> PageSnapshot:
        """
        Take a page snapshot. If CLI unavailable, returns empty snapshot.
        """
        if not self._use_cli:
            return PageSnapshot(url=self._current_url)

        args = ["snapshot"]
        if interactive_only:
            args.append("-i")
        output = await self._run_cli(*args)
        return self._parse_snapshot(output)

    async def click(self, ref: str) -> bool:
        """Click an element by reference ID."""
        if not self._use_cli:
            return False
        output = await self._run_cli("click", ref)
        return bool(output)

    async def fill(self, ref: str, text: str) -> bool:
        """Fill a form field by reference ID."""
        if not self._use_cli:
            return False
        output = await self._run_cli("fill", ref, text)
        return bool(output)

    async def extract_main_text(self, max_chars: int = MAX_EXTRACTED_TEXT_CHARS) -> ExtractedContent:
        """
        Extract clean main-content text from the current page.

        Tries agent-browser CLI first, falls back to httpx + BeautifulSoup.
        """
        if self._use_cli:
            output = await self._run_cli("extract-text")
            if output.strip():
                text = output.strip()[:max_chars]
                return ExtractedContent(url=self._current_url, text=text)

        return await self._fallback_extract(self._current_url, max_chars)

    async def try_dismiss_consent(self, snapshot: PageSnapshot) -> bool:
        """Heuristic: click consent/cookie buttons if found."""
        for el in snapshot.elements:
            text_lower = el.text.lower()
            if any(kw in text_lower for kw in CONSENT_KEYWORDS):
                try:
                    await self.click(el.ref)
                    await asyncio.sleep(0.5)
                    return True
                except Exception:
                    pass
        return False

    async def close(self) -> None:
        """Clean up session resources."""
        if self._closed:
            return
        self._closed = True
        await self._kill_process()
        try:
            if self.workdir.exists():
                shutil.rmtree(self.workdir, ignore_errors=True)
        except Exception as e:
            logger.warning("Failed to clean workdir %s: %s", self.workdir, e)

    def _parse_snapshot(self, raw: str) -> PageSnapshot:
        """Parse agent-browser snapshot output into PageSnapshot."""
        elements: list[InteractiveElement] = []
        title = ""

        for line in raw.split("\n"):
            line = line.strip()
            if not line:
                continue
            ref_match = re.match(r"\[(\d+)\]\s*<(\w+)([^>]*)>\s*(.*)", line)
            if ref_match:
                ref_id, tag, attrs, text = ref_match.groups()
                role = ""
                role_match = re.search(r'role="([^"]+)"', attrs)
                if role_match:
                    role = role_match.group(1)
                elements.append(InteractiveElement(
                    ref=ref_id, tag=tag, role=role, text=text[:120],
                ))
            elif line.startswith("Title:"):
                title = line[6:].strip()

        return PageSnapshot(
            url=self._current_url,
            title=title,
            elements=elements[:MAX_INTERACTIVE_ELEMENTS],
        )

    @staticmethod
    async def _fallback_extract(url: str, max_chars: int) -> ExtractedContent:
        """Fallback: use httpx + BeautifulSoup to extract text."""
        try:
            async with httpx.AsyncClient(
                timeout=15.0, follow_redirects=True, verify=_ssl_verify,
            ) as client:
                resp = await client.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (compatible; DeepSearchAgent/1.0)",
                })
                resp.raise_for_status()
                html = resp.text

            soup = BeautifulSoup(html, "html.parser")
            for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
                tag.decompose()
            text = soup.get_text(separator="\n", strip=True)
            text = re.sub(r"\n{3,}", "\n\n", text)
            return ExtractedContent(url=url, text=text[:max_chars])
        except Exception as e:
            logger.warning("Fallback extraction failed for %s: %s", url[:80], e)
            return ExtractedContent(url=url, text="[Content unavailable]")
