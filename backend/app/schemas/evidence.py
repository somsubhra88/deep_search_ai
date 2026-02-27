"""
Pydantic schemas for the evidence pipeline.

All server-side validation lives here — the frontend treats these as
source-of-truth and does no additional runtime validation.
"""

from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel, Field, field_validator

# ── Hard caps ────────────────────────────────────────────────────────────
MAX_INTERACTIVE_ELEMENTS = 60
MAX_ELEMENT_CHARS = 120
MAX_EXTRACTED_TEXT_CHARS = 6_000
MAX_SNIPPET_CHARS = 350
MAX_QUOTE_CHARS = 240
MAX_CLAIM_CHARS = 180
MAX_CARDS_PER_URL = 5
MAX_TOTAL_CARDS = 30


# ── Browser snapshot schemas ─────────────────────────────────────────────

class InteractiveElement(BaseModel):
    ref: str = Field(..., max_length=20, description="Element reference ID from agent-browser")
    tag: str = Field(..., max_length=20)
    role: str = Field(default="", max_length=30)
    text: str = Field(default="")

    @field_validator("text", mode="before")
    @classmethod
    def truncate_text(cls, v: str) -> str:
        if isinstance(v, str) and len(v) > MAX_ELEMENT_CHARS:
            return v[:MAX_ELEMENT_CHARS]
        return v


class PageSnapshot(BaseModel):
    """Interactive-only snapshot — never send full DOM to LLM."""
    url: str
    title: str = ""
    elements: list[InteractiveElement] = Field(default_factory=list)

    @field_validator("elements", mode="before")
    @classmethod
    def cap_elements(cls, v: list) -> list:
        if not isinstance(v, list):
            return v
        trimmed = v[:MAX_INTERACTIVE_ELEMENTS]
        seen_refs: set[str] = set()
        deduped: list = []
        for el in trimmed:
            ref = el.ref if hasattr(el, "ref") else (el.get("ref") if isinstance(el, dict) else None)
            if ref is not None and ref not in seen_refs:
                seen_refs.add(ref)
                deduped.append(el)
        return deduped


class ExtractedContent(BaseModel):
    """Clean text from a page, hard-capped."""
    url: str
    text: str = Field(default="")
    char_count: int = 0

    @field_validator("text", mode="before")
    @classmethod
    def cap_text(cls, v: str) -> str:
        if isinstance(v, str) and len(v) > MAX_EXTRACTED_TEXT_CHARS:
            return v[:MAX_EXTRACTED_TEXT_CHARS]
        return v

    def model_post_init(self, __context) -> None:
        self.char_count = len(self.text)


# ── Evidence card schemas ────────────────────────────────────────────────

class EvidenceCard(BaseModel):
    """Compact evidence unit — the ONLY thing the LLM sees per source."""
    card_id: str = Field(default_factory=lambda: f"ev-{uuid.uuid4().hex[:8]}")
    url: str = ""
    domain: str = ""
    title: str = ""
    snippet: str = Field(default="")
    quote: str = Field(default="")
    claim: str = Field(default="")
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    perspective: str = Field(default="neutral", description="FOR / AGAINST / neutral")
    source_type: str = Field(default="general", description="academic / news / social / government / general")

    @field_validator("snippet", mode="before")
    @classmethod
    def cap_snippet(cls, v: str) -> str:
        if isinstance(v, str) and len(v) > MAX_SNIPPET_CHARS:
            return v[:MAX_SNIPPET_CHARS]
        return v

    @field_validator("quote", mode="before")
    @classmethod
    def cap_quote(cls, v: str) -> str:
        if isinstance(v, str) and len(v) > MAX_QUOTE_CHARS:
            return v[:MAX_QUOTE_CHARS]
        return v

    @field_validator("claim", mode="before")
    @classmethod
    def cap_claim(cls, v: str) -> str:
        if isinstance(v, str) and len(v) > MAX_CLAIM_CHARS:
            return v[:MAX_CLAIM_CHARS]
        return v


class EvidenceCardList(BaseModel):
    """Wrapper with hard cap on total cards."""
    cards: list[EvidenceCard] = Field(default_factory=list)
    query: str = ""
    perspective: str = "neutral"
    total_urls_processed: int = 0
    total_cards: int = 0

    @field_validator("cards")
    @classmethod
    def cap_cards(cls, v: list[EvidenceCard]) -> list[EvidenceCard]:
        return v[:MAX_TOTAL_CARDS]

    def model_post_init(self, __context) -> None:
        self.total_cards = len(self.cards)


# ── Config schema for mode-level toggles ─────────────────────────────────

class EvidenceConfig(BaseModel):
    """Per-mode configuration for the evidence / RAG pipeline."""
    use_ephemeral_rag: bool = True
    use_evidence_cards: bool = True
    use_reranking: bool = True
    top_k_chunks: int = Field(default=6, ge=1, le=30)
    max_total_context_chars: int = Field(default=4_000, ge=500, le=20_000)
    max_urls: int = Field(default=8, ge=1, le=20)
    max_cards_per_url: int = Field(default=5, ge=1, le=10)
    map_reduce_enabled: bool = False
    cache_enabled: bool = True
    cache_bypass: bool = False


# Default configs per mode
MODE_EVIDENCE_DEFAULTS: dict[str, EvidenceConfig] = {
    "debate": EvidenceConfig(
        use_ephemeral_rag=True,
        use_evidence_cards=True,
        map_reduce_enabled=False,
    ),
    "deep_dive": EvidenceConfig(
        use_ephemeral_rag=True,
        use_evidence_cards=True,
        map_reduce_enabled=True,
        top_k_chunks=10,
        max_total_context_chars=6_000,
        max_urls=12,
    ),
    "academic": EvidenceConfig(
        use_ephemeral_rag=True,
        use_evidence_cards=True,
        map_reduce_enabled=True,
        top_k_chunks=8,
    ),
    "fact_check": EvidenceConfig(
        use_ephemeral_rag=True,
        use_evidence_cards=True,
        top_k_chunks=8,
    ),
    "standard": EvidenceConfig(
        use_ephemeral_rag=True,
        use_evidence_cards=False,
        top_k_chunks=6,
    ),
    "timeline": EvidenceConfig(
        use_ephemeral_rag=False,
        use_evidence_cards=False,
    ),
    "social_media": EvidenceConfig(
        use_ephemeral_rag=False,
        use_evidence_cards=False,
    ),
}


def get_evidence_config(mode: str) -> EvidenceConfig:
    return MODE_EVIDENCE_DEFAULTS.get(mode, EvidenceConfig())
