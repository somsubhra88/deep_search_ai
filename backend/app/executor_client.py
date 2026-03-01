"""
Client for the local Rust executor (127.0.0.1:7777).
Calls real tools: fs, net, shell, notes, clipboard.
"""

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

EXECUTOR_URL = os.getenv("EXECUTOR_URL", "http://127.0.0.1:7777")
EXECUTOR_TIMEOUT = float(os.getenv("EXECUTOR_TIMEOUT", "120"))

MAX_CONTENT_SIZE = 10 * 1024 * 1024  # 10 MB guard for write/append content


def _validate_tool(tool: dict[str, Any]) -> None:
    """Basic validation before sending to executor."""
    tool_name = tool.get("tool", "")
    if not tool_name or not isinstance(tool_name, str):
        raise ValueError("Missing or invalid tool name")
    content = tool.get("content")
    if content and isinstance(content, str) and len(content) > MAX_CONTENT_SIZE:
        raise ValueError(f"Content too large ({len(content)} bytes, max {MAX_CONTENT_SIZE})")


async def execute_tool(
    tool: dict[str, Any],
    run_id: str | None = None,
    dry_run: bool = False,
    context: dict | None = None,
) -> dict[str, Any]:
    """Execute a single tool. Blocks until approval if needed."""
    _validate_tool(tool)
    payload: dict[str, Any] = {"tool": tool, "dry_run": dry_run}
    if run_id:
        payload["run_id"] = run_id
    if context:
        payload["context"] = context

    async with httpx.AsyncClient(timeout=EXECUTOR_TIMEOUT) as client:
        resp = await client.post(
            f"{EXECUTOR_URL}/v1/tool/execute",
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


async def approval_respond(
    approval_id: str,
    decision: str,
    save_rule: dict | None = None,
) -> dict[str, Any]:
    """Respond to a pending approval (approve/deny)."""
    if decision not in ("approve", "deny"):
        raise ValueError(f"Invalid decision: {decision}")
    payload: dict[str, Any] = {"approval_id": approval_id, "decision": decision}
    if save_rule:
        payload["save_rule"] = save_rule

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{EXECUTOR_URL}/v1/approval/respond",
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


def events_stream_url(run_id: str) -> str:
    """URL for SSE stream of run events."""
    return f"{EXECUTOR_URL}/v1/runs/{run_id}/events"


def is_executor_available() -> bool:
    """Check if executor is reachable."""
    try:
        with httpx.Client(timeout=3) as client:
            resp = client.get(f"{EXECUTOR_URL}/v1/rules")
            return resp.status_code < 500
    except Exception:
        return False
