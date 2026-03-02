"""
Pydantic schemas for the Assistant: personas, context, and act request.
Server-driven persona definitions; frontend renders from API only.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Personas (GET /api/assistant/personas)
# ---------------------------------------------------------------------------

class PersonaDefinition(BaseModel):
    """Single persona as returned by the API (display + status)."""
    persona_id: str = Field(..., description="Unique id for this persona")
    display_name: str = Field(..., description="Display name (e.g. Research Analyst)")
    icon_key: str = Field(..., description="Icon identifier for frontend mapping")
    description: str = Field(..., description="One-line promise / description")
    example_prompts: List[str] = Field(default_factory=list, description="Suggested quick-action prompts")
    capabilities: List[str] = Field(default_factory=list, description="Tool groups enabled (e.g. research, files, email)")
    requires_setup: List[str] = Field(default_factory=list, description="Connectors required (e.g. email, calendar)")
    status: Literal["ready", "needs_setup", "connected"] = Field(..., description="Current status for this persona")
    last_activity_at: Optional[str] = Field(None, description="ISO timestamp of last activity if available")


# ---------------------------------------------------------------------------
# Search Bridge (POST /api/search/record, POST /api/search/{id}/action_suggestions)
# ---------------------------------------------------------------------------

class SearchRecordRequest(BaseModel):
    """Minimal search run to store for bridge and assistant reference."""
    id: str = Field(..., min_length=1, max_length=128)
    query: str = Field(..., min_length=1, max_length=500)
    created_at: int = Field(..., ge=0)
    mode: List[str] = Field(default_factory=list)
    provider: str = Field(default="serpapi", max_length=64)
    model: str = Field(default="", max_length=128)
    perspective: int = Field(default=50, ge=0, le=100)
    citations: List[dict] = Field(default_factory=list)
    summary_snippet: str = Field(default="", max_length=2000)


class ActionSuggestion(BaseModel):
    """Single suggestion from POST /api/search/{search_id}/action_suggestions."""
    action_id: str = Field(..., description="Stable id for pinning and reference")
    label: str = Field(..., description="Short button label")
    icon_key: str = Field(..., description="Icon identifier for UI")
    short_description: str = Field(default="")
    risk_hint: str = Field(default="low", description="low | medium | high")
    suggested_persona_id: str = Field(..., description="Persona to switch to in Assistant")
    prefill_prompt: str = Field(default="", description="Suggested user message to prefill")
