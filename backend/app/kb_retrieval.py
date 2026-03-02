"""
RAG retrieval engine — KB-only, Web-only, and Hybrid retrieval with
grounded answer generation and citation verification.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import AsyncGenerator

import numpy as np

from app.kb_models import get_embeddings_for_kb
from app.kb_schemas import (
    ConflictItem,
    CoverageGap,
    KBChunkResult,
    KBCitation,
    RAGCitations,
    RAGResponse,
    WebCitation,
)
from app.schemas.explain import (
    CacheDecision,
    ExplainPayload,
    GenerationExplain,
    RetrievalExplain,
    TopSource,
)
from app.rag.embeddings import Embedder, get_embedder

logger = logging.getLogger(__name__)

MAX_CONTEXT_CHARS = 6000
KB_SNIPPET_CAP = 500
WEB_SNIPPET_CAP = 400


# ---------------------------------------------------------------------------
# KB vector retrieval
# ---------------------------------------------------------------------------

def retrieve_kb_chunks(
    kb_id: str,
    query: str,
    top_k: int = 6,
    embedder: Embedder | None = None,
) -> list[KBChunkResult]:
    """
    Embed query and search KB chunks by cosine similarity.
    Returns top_k results.
    """
    if embedder is None:
        embedder = get_embedder()

    model_id = type(embedder).__name__
    rows = get_embeddings_for_kb(kb_id, model_id)

    if not rows:
        return []

    # Build matrix
    dim = embedder.dim
    vectors = []
    chunk_meta = []
    for r in rows:
        vec_bytes = r["vector"]
        vec = np.frombuffer(vec_bytes, dtype=np.float32)
        if vec.shape[0] != dim:
            continue
        vectors.append(vec)
        chunk_meta.append(r)

    if not vectors:
        return []

    matrix = np.stack(vectors)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1, norms)
    matrix = matrix / norms

    q_emb = embedder.embed_one(query)
    q_norm = np.linalg.norm(q_emb)
    if q_norm > 0:
        q_emb = q_emb / q_norm

    scores = matrix @ q_emb
    top_indices = np.argsort(scores)[::-1][:top_k]

    results = []
    for idx in top_indices:
        meta = chunk_meta[int(idx)]
        score = float(scores[int(idx)])
        if score < 0.05:
            continue
        page_range = ""
        if meta.get("page_start") is not None:
            if meta.get("page_end") and meta["page_end"] != meta["page_start"]:
                page_range = f"p.{meta['page_start']}-{meta['page_end']}"
            else:
                page_range = f"p.{meta['page_start']}"
        results.append(KBChunkResult(
            chunk_id=meta["chunk_id"] if "chunk_id" in meta else meta["id"],
            doc_id=meta["doc_id"],
            filename=meta.get("filename", ""),
            page_range=page_range,
            section_title=meta.get("section_title", "") or "",
            text_snippet=meta["text"][:KB_SNIPPET_CAP],
            score=score,
        ))
    return results


# ---------------------------------------------------------------------------
# Hybrid context builder
# ---------------------------------------------------------------------------

def _build_kb_context(chunks: list[KBChunkResult], max_chars: int) -> str:
    lines = []
    total = 0
    for i, c in enumerate(chunks):
        label = f"[KB-{i+1}] {c.filename}"
        if c.page_range:
            label += f" ({c.page_range})"
        snippet = c.text_snippet[:max_chars - total]
        lines.append(f"{label}:\n{snippet}")
        total += len(snippet) + len(label) + 2
        if total >= max_chars:
            break
    return "\n\n".join(lines)


def _build_web_context(cards: list[dict], max_chars: int) -> str:
    lines = []
    total = 0
    for i, card in enumerate(cards):
        label = f"[WEB-{i+1}] {card.get('title', card.get('url', ''))}"
        snippet = (card.get("snippet", "") or card.get("quote", ""))[:WEB_SNIPPET_CAP]
        entry = f"{label}:\n{snippet}"
        lines.append(entry)
        total += len(entry)
        if total >= max_chars:
            break
    return "\n\n".join(lines)


# ---------------------------------------------------------------------------
# Grounded generation prompt
# ---------------------------------------------------------------------------

GROUNDED_SYSTEM_PROMPT = r"""You are a research assistant that answers questions using ONLY the provided context.
You have two types of sources:
1. KB (Knowledge Base) — local documents uploaded by the user. These are authoritative.
2. WEB — evidence from web searches.

FORMATTING RULES for the answer_markdown field:
- Write in well-structured, readable Markdown.
- Use clear section headings (## or ###) to organize the answer by topic/theme.
- Use short paragraphs (2-4 sentences each). NEVER write a single giant paragraph.
- Use bullet points or numbered lists when presenting multiple items, steps, or comparisons.
- Use **bold** for key terms and important concepts being defined or emphasized.
- Use > blockquotes for important findings or direct conclusions.
- For mathematical expressions, ALWAYS use LaTeX with dollar-sign delimiters: $x^2$ for inline, $$E = mc^2$$ for display.
- NEVER use raw backslash LaTeX like \mathbf{v} outside of dollar signs. Always wrap: $\mathbf{v}$, $\alpha$, $P \approx (I - \alpha M)^{-1}$.
- For vectors, matrices, greek letters: $\vec{\pi}$, $\frac{1}{n}$, $\epsilon$, $\|\cdot\|$.
- Place [KB-N] or [WEB-N] citation tags INLINE right after the claim they support, not at the end of paragraphs.
- Each citation tag must appear at least once in the answer text.

CONTENT RULES:
- If KB and WEB sources conflict, note the conflict explicitly and prefer KB as authoritative.
- If evidence is insufficient, say so clearly.
- Be comprehensive but concise. Aim for depth with clarity.

Output format — return ONLY this JSON (no markdown fences around it):
{
  "answer_markdown": "## Section Heading\\n\\nWell-formatted answer with **bold terms** and [KB-1] citations inline...\\n\\n### Sub-section\\n\\n- Point one [KB-2]\\n- Point two [WEB-1]",
  "citations": {
    "kb": [{"chunk_id": "...", "doc_id": "...", "filename": "...", "quote": "short exact quote used", "used_in": ["S1"]}],
    "web": [{"card_id": "...", "url": "...", "quote": "short exact quote used", "used_in": ["S2"]}]
  },
  "conflicts": [{"statement": "...", "kb_support": ["chunk_id"], "web_support": ["card_id"], "note": "..."}],
  "coverage_gaps": [{"gap": "description of what's missing", "suggested_query": "follow-up query"}]
}"""


def _build_generation_prompt(
    query: str,
    kb_context: str,
    web_context: str,
    kb_chunks: list[KBChunkResult],
    web_cards: list[dict],
) -> str:
    parts = [f"User question: {query}\n"]

    if kb_context:
        parts.append(f"=== KNOWLEDGE BASE CONTEXT ===\n{kb_context}\n")
    if web_context:
        parts.append(f"=== WEB EVIDENCE ===\n{web_context}\n")

    if not kb_context and not web_context:
        parts.append("No context available. Inform the user that no relevant information was found.\n")

    # Include metadata for citation building
    if kb_chunks:
        chunk_ref = json.dumps([
            {"ref": f"KB-{i+1}", "chunk_id": c.chunk_id, "doc_id": c.doc_id, "filename": c.filename}
            for i, c in enumerate(kb_chunks)
        ], indent=None)
        parts.append(f"KB chunk references: {chunk_ref}\n")

    if web_cards:
        card_ref = json.dumps([
            {"ref": f"WEB-{i+1}", "card_id": c.get("card_id", f"web-{i}"), "url": c.get("url", "")}
            for i, c in enumerate(web_cards)
        ], indent=None)
        parts.append(f"Web card references: {card_ref}\n")

    parts.append("Now generate a well-cited answer following the output format specified in the system prompt.")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# LLM call for grounded generation
# ---------------------------------------------------------------------------

async def _call_llm_for_answer(
    system_prompt: str,
    user_prompt: str,
    model_id: str = "openai",
    model_name: str | None = None,
) -> str:
    """Call the LLM and return raw text response."""
    from app.agent import _get_llm

    llm = _get_llm(model_id, model_name)
    from langchain_core.messages import SystemMessage, HumanMessage

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]

    try:
        response = await llm.ainvoke(messages)
        return response.content
    except Exception as e:
        logger.error("LLM call failed: %s", e)
        raise


def _parse_rag_response(raw: str, kb_chunks: list[KBChunkResult], web_cards: list[dict]) -> RAGResponse:
    """Parse the LLM's JSON response into a RAGResponse, with fallback."""
    # Try to extract JSON from the response
    json_match = re.search(r"\{[\s\S]*\}", raw)
    if json_match:
        try:
            data = json.loads(json_match.group())
            citations = data.get("citations", {})
            kb_cites = []
            for c in citations.get("kb", []):
                kb_cites.append(KBCitation(
                    chunk_id=c.get("chunk_id", ""),
                    doc_id=c.get("doc_id", ""),
                    filename=c.get("filename", ""),
                    quote=c.get("quote", ""),
                    used_in=c.get("used_in", []),
                ))
            web_cites = []
            for c in citations.get("web", []):
                web_cites.append(WebCitation(
                    card_id=c.get("card_id", ""),
                    url=c.get("url", ""),
                    quote=c.get("quote", ""),
                    used_in=c.get("used_in", []),
                ))
            conflicts = [
                ConflictItem(**c) for c in data.get("conflicts", [])
            ]
            gaps = [
                CoverageGap(**g) for g in data.get("coverage_gaps", [])
            ]
            return RAGResponse(
                answer_markdown=data.get("answer_markdown", raw),
                citations=RAGCitations(kb=kb_cites, web=web_cites),
                conflicts=conflicts,
                coverage_gaps=gaps,
                kb_chunks_used=len(kb_chunks),
                web_cards_used=len(web_cards),
            )
        except (json.JSONDecodeError, TypeError, KeyError) as e:
            logger.warning("Failed to parse structured RAG response: %s", e)

    # Fallback: return raw text as answer
    return RAGResponse(
        answer_markdown=raw,
        citations=RAGCitations(),
        conflicts=[],
        coverage_gaps=[CoverageGap(gap="Could not parse structured output", suggested_query="")],
        kb_chunks_used=len(kb_chunks),
        web_cards_used=len(web_cards),
    )


# ---------------------------------------------------------------------------
# Citation verifier
# ---------------------------------------------------------------------------

def _verify_citations(response: RAGResponse, kb_chunks: list[KBChunkResult], web_cards: list[dict]) -> RAGResponse:
    """Check that quoted text actually appears in referenced chunks/cards."""
    chunk_texts = {c.chunk_id: c.text_snippet for c in kb_chunks}
    card_texts = {c.get("card_id", ""): (c.get("snippet", "") + " " + c.get("quote", "")) for c in web_cards}

    valid_kb = []
    for cite in response.citations.kb:
        ref_text = chunk_texts.get(cite.chunk_id, "")
        if cite.quote and cite.quote.lower() in ref_text.lower():
            valid_kb.append(cite)
        elif cite.quote:
            # Fuzzy: check if >50% of words match
            quote_words = set(cite.quote.lower().split())
            ref_words = set(ref_text.lower().split())
            overlap = len(quote_words & ref_words) / max(len(quote_words), 1)
            if overlap > 0.5:
                valid_kb.append(cite)
            else:
                cite.quote = f"[unverified] {cite.quote}"
                valid_kb.append(cite)
        else:
            valid_kb.append(cite)

    valid_web = []
    for cite in response.citations.web:
        ref_text = card_texts.get(cite.card_id, "")
        if cite.quote and cite.quote.lower() in ref_text.lower():
            valid_web.append(cite)
        elif cite.quote:
            quote_words = set(cite.quote.lower().split())
            ref_words = set(ref_text.lower().split())
            overlap = len(quote_words & ref_words) / max(len(quote_words), 1)
            if overlap > 0.5:
                valid_web.append(cite)
            else:
                cite.quote = f"[unverified] {cite.quote}"
                valid_web.append(cite)
        else:
            valid_web.append(cite)

    response.citations = RAGCitations(kb=valid_kb, web=valid_web)
    return response


# ---------------------------------------------------------------------------
# Main query orchestrator
# ---------------------------------------------------------------------------

async def query_rag(
    kb_id: str,
    query: str,
    scope: str = "HYBRID",
    top_k_kb: int = 6,
    top_k_web: int = 4,
    model_id: str = "openai",
    model_name: str | None = None,
    web_evidence_cards: list[dict] | None = None,
    progress_callback=None,
) -> RAGResponse:
    """
    Main RAG query entry point.

    scope: KB_ONLY, WEB_ONLY, HYBRID
    progress_callback: optional async callable(event_type: str, data: dict)
    """
    if progress_callback:
        await progress_callback("rag.started", {"query": query, "scope": scope})

    kb_chunks: list[KBChunkResult] = []
    web_cards: list[dict] = web_evidence_cards or []

    # Parallel retrieval
    async def _retrieve_kb():
        nonlocal kb_chunks
        if scope in ("KB_ONLY", "HYBRID"):
            kb_chunks = retrieve_kb_chunks(kb_id, query, top_k=top_k_kb)

    async def _retrieve_web():
        nonlocal web_cards
        if scope in ("WEB_ONLY", "HYBRID") and not web_cards:
            # Attempt to use existing web evidence pipeline
            try:
                from app.agent import _get_llm
                from app.evidence.web_evidence_worker import collect_web_evidence
                llm = _get_llm(model_id, model_name)
                result = await collect_web_evidence(
                    query=query, urls=[], llm=llm,
                    perspective="neutral", max_urls=top_k_web, max_cards_per_url=3,
                )
                web_cards = [c.model_dump() for c in result.cards]
            except Exception as e:
                logger.warning("Web evidence collection failed: %s", e)

    await asyncio.gather(_retrieve_kb(), _retrieve_web())

    if progress_callback:
        if kb_chunks:
            await progress_callback("rag.kb.retrieved", {"count": len(kb_chunks)})
        if web_cards:
            await progress_callback("rag.web.retrieved", {"count": len(web_cards)})

    # Build context with char budget
    kb_budget = MAX_CONTEXT_CHARS * 6 // 10 if scope == "HYBRID" else MAX_CONTEXT_CHARS
    web_budget = MAX_CONTEXT_CHARS * 4 // 10 if scope == "HYBRID" else MAX_CONTEXT_CHARS

    if scope == "KB_ONLY":
        web_budget = 0
    elif scope == "WEB_ONLY":
        kb_budget = 0

    kb_context = _build_kb_context(kb_chunks, kb_budget) if kb_chunks else ""
    web_context = _build_web_context(web_cards, web_budget) if web_cards else ""

    # Generate answer
    if progress_callback:
        await progress_callback("rag.generating", {})

    user_prompt = _build_generation_prompt(query, kb_context, web_context, kb_chunks, web_cards)

    try:
        raw_response = await _call_llm_for_answer(
            GROUNDED_SYSTEM_PROMPT, user_prompt, model_id, model_name
        )
    except Exception as e:
        return RAGResponse(
            answer_markdown=f"Error generating answer: {e}",
            scope_used=scope,
        )

    # Parse
    response = _parse_rag_response(raw_response, kb_chunks, web_cards)
    response.scope_used = scope

    # Verify citations
    if progress_callback:
        await progress_callback("rag.verifying", {})

    response = _verify_citations(response, kb_chunks, web_cards)

    # Attach structured explain (no prompts or secrets)
    top_sources: list[dict] = []
    for c in kb_chunks[:10]:
        top_sources.append({
            "title": (c.filename or c.doc_id or "")[:200],
            "url": "",
            "doc_id": c.doc_id,
            "score": c.score,
        })
    for i, c in enumerate(web_cards[:6]):
        top_sources.append({
            "title": (c.get("title") or c.get("url", ""))[:200],
            "url": c.get("url", ""),
            "doc_id": "",
            "score": None,
        })
    retrieval = RetrievalExplain(
        sources_considered_count=len(kb_chunks) + len(web_cards),
        top_sources=[TopSource(**s) for s in top_sources],
        retrieval_params={"top_k_kb": top_k_kb, "top_k_web": top_k_web, "scope": scope},
        why_these_sources=f"Retrieved {len(kb_chunks)} KB chunks and {len(web_cards)} web cards by semantic similarity (scope: {scope}).",
    )
    generation = GenerationExplain(model=model_name or model_id, provider=model_id, prompt_version="1")
    explain = ExplainPayload(
        cache_decision=None,
        retrieval=retrieval,
        generation=generation,
        safety=None,
    )
    response.explain = explain.model_dump()

    if progress_callback:
        await progress_callback("rag.final", response.model_dump())

    return response


# ---------------------------------------------------------------------------
# SSE streaming wrapper
# ---------------------------------------------------------------------------

async def query_rag_stream(
    kb_id: str,
    query: str,
    scope: str = "HYBRID",
    top_k_kb: int = 6,
    top_k_web: int = 4,
    model_id: str = "openai",
    model_name: str | None = None,
) -> AsyncGenerator[dict, None]:
    """
    Stream RAG query progress as SSE-compatible events.
    """
    events: list[dict] = []

    async def _collect(event_type: str, data: dict):
        events.append({"event": event_type, "data": data})

    # Yield start
    yield {"event": "rag.started", "data": {"query": query, "scope": scope}}

    try:
        response = await query_rag(
            kb_id=kb_id,
            query=query,
            scope=scope,
            top_k_kb=top_k_kb,
            top_k_web=top_k_web,
            model_id=model_id,
            model_name=model_name,
            progress_callback=_collect,
        )

        # Yield collected intermediate events (skip rag.started which we already sent)
        for ev in events:
            if ev["event"] != "rag.started":
                yield ev

        yield {"event": "rag.final", "data": response.model_dump()}

    except Exception as e:
        yield {"event": "rag.error", "data": {"error": str(e)}}
