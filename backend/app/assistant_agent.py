"""
Assistant agent: maps user messages to executor tools and runs them.
Uses LLM to decide which tool to call, then executes via the Rust executor.
"""

import json
import logging
import re
from typing import Any

from app.agent import _get_llm
from app.executor_client import execute_tool, is_executor_available

logger = logging.getLogger(__name__)

TOOLS_SCHEMA = """
Available tools (return exactly one JSON object, or {"tool": null} if no action):
- fs_list: {"tool": "fs_list", "path": "<dir path>"}
- fs_read: {"tool": "fs_read", "path": "<file path>"}
- fs_stat: {"tool": "fs_stat", "path": "<path>"}
- fs_write: {"tool": "fs_write", "path": "<path>", "content": "<string>"}
- fs_append: {"tool": "fs_append", "path": "<path>", "content": "<string>"}
- fs_copy: {"tool": "fs_copy", "src": "<path>", "dst": "<path>"}
- fs_move: {"tool": "fs_move", "src": "<path>", "dst": "<path>"}
- fs_rename: {"tool": "fs_rename", "src": "<path>", "dst": "<path>"}
- fs_delete: {"tool": "fs_delete", "path": "<path>"}
- net_download: {"tool": "net_download", "url": "<url>", "dst_path": "<path>"}
- archive_extract: {"tool": "archive_extract", "archive_path": "<path>", "dst_dir": "<path>"}
- shell_run: {"tool": "shell_run", "cmd": "<command>", "cwd": "<optional dir>"}
- notes_create: {"tool": "notes_create", "title": "<title>", "content": "<string>", "folder": "<optional>"}
- notes_update: {"tool": "notes_update", "title": "<title>", "content": "<string>", "folder": "<optional>"}
- notes_search: {"tool": "notes_search", "query": "<search term>", "folder": "<optional>"}
- clipboard_read: {"tool": "clipboard_read"}
- clipboard_write: {"tool": "clipboard_write", "content": "<string>"}

Paths: use absolute paths or paths relative to user home. For "list my files" use home dir.
"""


def _parse_tool_response(text: str) -> dict | None:
    """Extract JSON tool call from LLM response."""
    text = text.strip()
    # Try to find JSON block
    for pattern in [
        r"\{[^{}]*\"tool\"[^{}]*\}",
        r"```json\s*(\{.*?\})\s*```",
        r"```\s*(\{.*?\})\s*```",
    ]:
        m = re.search(pattern, text, re.DOTALL)
        if m:
            try:
                raw = m.group(1) if m.lastindex else m.group(0)
                obj = json.loads(raw)
                if isinstance(obj, dict) and "tool" in obj:
                    return obj
            except json.JSONDecodeError:
                continue
    # Try parsing whole response
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and "tool" in obj:
            return obj
    except json.JSONDecodeError:
        pass
    return None


def _to_executor_tool(parsed: dict) -> dict[str, Any]:
    """Convert parsed tool to executor API format (snake_case tool tag)."""
    tool_name = (parsed.get("tool") or "").strip()
    if not tool_name or tool_name == "null":
        return {}

    tool_map = {
        "fs_list": ("fs_list", ["path"]),
        "fs_read": ("fs_read", ["path"]),
        "fs_stat": ("fs_stat", ["path"]),
        "fs_write": ("fs_write", ["path", "content"]),
        "fs_append": ("fs_append", ["path", "content"]),
        "fs_copy": ("fs_copy", ["src", "dst"]),
        "fs_move": ("fs_move", ["src", "dst"]),
        "fs_rename": ("fs_rename", ["src", "dst"]),
        "fs_delete": ("fs_delete", ["path"]),
        "net_download": ("net_download", ["url", "dst_path"]),
        "archive_extract": ("archive_extract", ["archive_path", "dst_dir"]),
        "shell_run": ("shell_run", ["cmd", "cwd"]),
        "notes_create": ("notes_create", ["title", "content", "folder"]),
        "notes_update": ("notes_update", ["title", "content", "folder"]),
        "notes_search": ("notes_search", ["query", "folder"]),
        "clipboard_read": ("clipboard_read", []),
        "clipboard_write": ("clipboard_write", ["content"]),
    }

    if tool_name not in tool_map:
        return {}
    api_name, params = tool_map[tool_name]
    out: dict[str, Any] = {"tool": api_name}
    for p in params:
        if p in parsed and parsed[p] is not None:
            out[p] = str(parsed[p]).strip() if isinstance(parsed[p], str) else parsed[p]
    return out


def _sanitize_message(message: str) -> str:
    """Strip control characters and limit length for LLM prompt safety."""
    import unicodedata
    cleaned = "".join(c for c in message if unicodedata.category(c)[0] != "C" or c in "\n\t")
    return cleaned[:2000]


async def message_to_tool(message: str, model_id: str = "openai", context: dict | None = None) -> dict | None:
    """
    Use LLM to convert user message to a tool request.
    Returns executor-ready tool dict or None if no action.
    """
    message = _sanitize_message(message)
    llm = _get_llm(model_id)
    path_hint = ""
    if context and context.get("path"):
        safe_path = str(context["path"]).replace('"', '\\"')[:500]
        path_hint = f'\n\nIMPORTANT: Use this exact path for the file: "{safe_path}"'
    prompt = f"""You are an assistant that takes real actions on the user's computer.
The user said: "{message}"{path_hint}

{TOOLS_SCHEMA}

If the user wants you to DO something (list files, read file, delete, move, download, run command, create note, etc.),
return the appropriate tool JSON. Use the user's home directory for paths when they say "my files" or "home". Paths like ~/Downloads/file.csv are valid.
If the user is just asking a question or chatting with no clear action, return {{"tool": null}}.

Reply with ONLY the JSON object, no other text."""

    try:
        from langchain_core.messages import HumanMessage

        resp = await llm.ainvoke([HumanMessage(content=prompt)])
        text = resp.content if hasattr(resp, "content") else str(resp)
        parsed = _parse_tool_response(text)
        if not parsed:
            return None
        tool = _to_executor_tool(parsed)
        return tool if tool else None
    except Exception as e:
        logger.exception("message_to_tool failed: %s", e)
        return None


async def act(
    message: str,
    run_id: str,
    context: dict | None = None,
    model_id: str = "openai",
) -> dict[str, Any]:
    """
    Interpret message, pick tool, execute via executor.
    Returns {run_id, result, tool, error?, approval_required?}.
    """
    if not is_executor_available():
        return {
            "run_id": run_id,
            "error": "Executor not available. Run: `cd executor-rust && cargo run` (local) or `make start` (Docker). The executor performs file, note, and clipboard actions.",
            "executor_available": False,
        }

    tool = await message_to_tool(message, model_id, context)
    if not tool:
        return {
            "run_id": run_id,
            "result": None,
            "message": "No action to perform. Try: list my files, read a file, create a note, etc.",
        }

    try:
        payload: dict[str, Any] = {"tool": tool, "run_id": run_id, "dry_run": False}
        if context:
            payload["context"] = context

        result = await execute_tool(
            tool=tool,
            run_id=run_id,
            dry_run=False,
            context=context,
        )
        return {
            "run_id": run_id,
            "result": result,
            "tool": tool,
            "executor_available": True,
        }
    except Exception as e:
        err = str(e)
        # Check if it's an approval timeout (user didn't approve in time)
        if "timed out" in err.lower() or "approval" in err.lower():
            return {
                "run_id": run_id,
                "error": "Action requires your approval. Please click Approve in the notification.",
                "approval_required": True,
                "tool": tool,
            }
        return {
            "run_id": run_id,
            "error": err,
            "tool": tool,
            "executor_available": True,
        }
