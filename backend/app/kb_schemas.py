"""
Pydantic schemas for the Knowledge Base + RAG pipeline.
"""

from typing import List, Literal, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# KB Management
# ---------------------------------------------------------------------------

class KBCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)


class KBResponse(BaseModel):
    id: str
    name: str
    description: str
    created_at: str
    doc_count: int = 0


class DocStatusItem(BaseModel):
    filename: str
    content_hash: str
    doc_id: str
    status: Literal["indexed", "skipped_cached", "failed", "pending"]
    message: str = ""
    chunk_count: int = 0


class UploadResponse(BaseModel):
    kb_id: str
    results: List[DocStatusItem]
    total_files: int = 0
    indexed: int = 0
    skipped_cached: int = 0
    failed: int = 0


class DocumentResponse(BaseModel):
    id: str
    kb_id: str
    filename: str
    mime_type: str
    file_ext: str
    size_bytes: int
    content_hash_sha256: str
    source_type: str
    relative_path: str
    status: str
    error_message: Optional[str] = None
    created_at: str
    updated_at: str
    chunk_count: int = 0


# ---------------------------------------------------------------------------
# RAG Query
# ---------------------------------------------------------------------------

class RAGQueryRequest(BaseModel):
    kb_id: str
    query: str = Field(min_length=2, max_length=500)
    scope: Literal["KB_ONLY", "WEB_ONLY", "HYBRID"] = "HYBRID"
    top_k_kb: int = Field(default=6, ge=1, le=20)
    top_k_web: int = Field(default=4, ge=1, le=10)
    perspective_dial: int = Field(default=50, ge=0, le=100)
    model_id: str = "openai"
    model_name: Optional[str] = None


# ---------------------------------------------------------------------------
# RAG Output
# ---------------------------------------------------------------------------

class KBCitation(BaseModel):
    chunk_id: str
    doc_id: str
    filename: str = ""
    page_range: str = ""
    quote: str
    used_in: List[str] = Field(default_factory=list)


class WebCitation(BaseModel):
    card_id: str
    url: str
    quote: str
    used_in: List[str] = Field(default_factory=list)


class ConflictItem(BaseModel):
    statement: str
    kb_support: List[str] = Field(default_factory=list)
    web_support: List[str] = Field(default_factory=list)
    note: str = ""


class CoverageGap(BaseModel):
    gap: str
    suggested_query: str = ""


class RAGCitations(BaseModel):
    kb: List[KBCitation] = Field(default_factory=list)
    web: List[WebCitation] = Field(default_factory=list)


class RAGResponse(BaseModel):
    answer_markdown: str
    citations: RAGCitations = Field(default_factory=RAGCitations)
    conflicts: List[ConflictItem] = Field(default_factory=list)
    coverage_gaps: List[CoverageGap] = Field(default_factory=list)
    scope_used: str = "HYBRID"
    kb_chunks_used: int = 0
    web_cards_used: int = 0
    explain: Optional[dict] = Field(default=None, description="Structured explainability payload")


# ---------------------------------------------------------------------------
# KB Chunk (returned from retrieval)
# ---------------------------------------------------------------------------

class KBChunkResult(BaseModel):
    chunk_id: str
    doc_id: str
    filename: str = ""
    page_range: str = ""
    section_title: str = ""
    text_snippet: str
    score: float = 0.0
