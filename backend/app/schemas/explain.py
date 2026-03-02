"""
Structured explainability payload for Search and Assistant answers.
Safe: no system prompts or secrets. Grounded in retrieval/generation metadata.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CacheDecision(BaseModel):
    """Cache hit/miss and why (for search or RAG)."""
    hit: bool = False
    kind: str = Field(default="search", description="e.g. search, semantic, none")
    hits: int = 0
    misses: int = 0
    hit_rate: str = ""
    why: str = Field(default="", max_length=200)


class TopSource(BaseModel):
    """Single source used in retrieval (title, url or doc_id, score)."""
    title: str = ""
    url: str = Field(default="", description="URL or doc_id")
    doc_id: str = Field(default="", description="For KB chunks")
    score: float | None = None


class RetrievalExplain(BaseModel):
    """Retrieval metadata for explain panel."""
    sources_considered_count: int = 0
    top_sources: list[TopSource] = Field(default_factory=list)
    retrieval_params: dict[str, Any] = Field(default_factory=dict)
    why_these_sources: str = Field(default="", max_length=500)


class GenerationExplain(BaseModel):
    """Generation metadata (model, params). No prompts or secrets."""
    model: str = ""
    provider: str = ""
    prompt_version: str = Field(default="", max_length=64)
    temperature: float | None = None
    max_tokens: int | None = None


class ToolCallSummary(BaseModel):
    """Single tool call for safety/transparency."""
    tool: str = ""
    summary: str = Field(default="", max_length=200)


class SafetyExplain(BaseModel):
    """Safety and approvals (no secrets)."""
    risk_level: str | None = Field(default=None, description="safe | needs_approval | blocked | null")
    approvals: list[dict[str, Any]] = Field(default_factory=list)
    tool_calls: list[ToolCallSummary] = Field(default_factory=list)


class ExplainPayload(BaseModel):
    """Optional explain object attached to Search or Assistant responses."""
    cache_decision: CacheDecision | None = None
    retrieval: RetrievalExplain | None = None
    generation: GenerationExplain | None = None
    safety: SafetyExplain | None = None
