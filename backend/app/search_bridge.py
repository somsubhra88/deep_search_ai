"""
Search → Assistant Bridge: minimal storage for search runs and action-suggestion logic.
Each search produces a stable search_id; assistant can reference it for context.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.agent import _get_llm
from app.personas import get_personas_config

logger = logging.getLogger(__name__)

# In-memory store: search_id -> record. Optional: persist to file/sqlite later.
_search_runs: dict[str, dict[str, Any]] = {}

# Prompt version for action suggestions (server-side, versioned).
ACTION_SUGGESTIONS_PROMPT_VERSION = "1"

VALID_ICON_KEYS = {"search", "folder", "mail", "calendar", "list", "zap"}
VALID_RISK_HINTS = {"low", "medium", "high"}


def save_search_run(
    search_id: str,
    query: str,
    created_at: int,
    mode: list[str],
    provider: str,
    model: str,
    perspective: int,
    citations: list[dict],
    summary_snippet: str,
) -> None:
    """Store minimal search record for bridge and assistant reference."""
    _search_runs[search_id] = {
        "id": search_id,
        "query": query,
        "created_at": created_at,
        "mode": mode,
        "provider": provider,
        "model": model,
        "perspective": perspective,
        "citations": citations[:20],
        "summary_snippet": (summary_snippet or "")[:2000],
    }
    # Keep store bounded (e.g. last 100)
    if len(_search_runs) > 100:
        by_time = sorted(_search_runs.items(), key=lambda x: x[1].get("created_at", 0))
        for sid, _ in by_time[: len(_search_runs) - 100]:
            _search_runs.pop(sid, None)


def get_search_run(search_id: str) -> dict[str, Any] | None:
    """Return stored search record or None."""
    return _search_runs.get(search_id)


def _allowed_persona_ids() -> list[str]:
    return [p["persona_id"] for p in get_personas_config()]


async def generate_action_suggestions(
    search_id: str,
    perspective_dial: int,
    modes: list[str],
    model_id: str = "openai",
) -> list[dict[str, Any]]:
    """
    Use LLM to generate 4–8 context-aware action suggestions.
    Guardrails: only existing persona_ids and icon_keys; actionable, no hallucinated tools.
    """
    record = get_search_run(search_id)
    if not record:
        logger.warning("No search run for search_id=%s", search_id)
        return []

    query = record.get("query", "")
    summary = record.get("summary_snippet", "") or query[:500]
    citations = record.get("citations", [])
    allowed_personas = _allowed_persona_ids()

    citations_text = ""
    if citations:
        for i, c in enumerate(citations[:8]):
            title = c.get("title") or c.get("url", "")[:60]
            citations_text += f"  [{i + 1}] {title}\n"
    if not citations_text:
        citations_text = "  (none)\n"

    prompt = f"""You are an assistant that suggests follow-up actions after a user has run a research search.
Your task: given the research context below, suggest 4 to 8 actionable next steps that the user can take in the Assistant (e.g. summarise in email, add to calendar, save as note, dig deeper with another persona).

RULES:
- Only suggest actions that map to EXISTING assistant personas/tools. Valid persona_id values (use exactly these): {json.dumps(allowed_personas)}.
- Each suggestion must have: action_id (short slug, e.g. "email_summary"), label (short button text, max 4 words), icon_key (one of: {json.dumps(list(VALID_ICON_KEYS))}), short_description (one line), risk_hint (one of: low, medium, high), suggested_persona_id (one of the valid persona_ids above), prefill_prompt (exact suggested user message to type in Assistant, can be a sentence).
- Be specific to THIS research (query and summary). Do not suggest generic actions.
- Keep labels concise. prefill_prompt can reference the research topic.

Research query: {query[:300]}
Summary snippet: {summary[:800]}

Top citations:
{citations_text}

User context: perspective_dial={perspective_dial}, modes={json.dumps(modes)}.

Return ONLY a JSON array of objects, each with keys: action_id, label, icon_key, short_description, risk_hint, suggested_persona_id, prefill_prompt. No other text."""

    try:
        llm = _get_llm(model_id)
        from langchain_core.messages import HumanMessage
        resp = await llm.ainvoke([HumanMessage(content=prompt)])
        text = (resp.content or "").strip()
        # Extract JSON array
        match = re.search(r"\[[\s\S]*\]", text)
        if not match:
            return []
        raw = json.loads(match.group())
        if not isinstance(raw, list):
            return []
        out = []
        for i, item in enumerate(raw[:8]):
            if not isinstance(item, dict):
                continue
            action_id = str(item.get("action_id") or f"action_{i}").replace(" ", "_")[:64]
            label = str(item.get("label") or "Action")[:40]
            icon_key = str(item.get("icon_key") or "zap").lower()
            if icon_key not in VALID_ICON_KEYS:
                icon_key = "zap"
            short_description = str(item.get("short_description") or "")[:200]
            risk_hint = str(item.get("risk_hint") or "low").lower()
            if risk_hint not in VALID_RISK_HINTS:
                risk_hint = "low"
            suggested_persona_id = str(item.get("suggested_persona_id") or "")
            if suggested_persona_id not in allowed_personas:
                suggested_persona_id = allowed_personas[0] if allowed_personas else ""
            prefill_prompt = str(item.get("prefill_prompt") or label)[:500]
            out.append({
                "action_id": action_id,
                "label": label,
                "icon_key": icon_key,
                "short_description": short_description,
                "risk_hint": risk_hint,
                "suggested_persona_id": suggested_persona_id,
                "prefill_prompt": prefill_prompt,
            })
        return out
    except Exception as e:
        logger.exception("generate_action_suggestions failed: %s", e)
        return []
