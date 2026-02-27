"""
Evidence distiller — uses an LLM to extract structured EvidenceCards
from raw extracted text.

The LLM receives ONLY the clean extracted text (never raw HTML/DOM).
Output is validated with Pydantic; one retry on failure; heuristic fallback.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Optional
from urllib.parse import urlparse

from app.schemas.evidence import (
    EvidenceCard,
    MAX_CARDS_PER_URL,
    MAX_CLAIM_CHARS,
    MAX_QUOTE_CHARS,
    MAX_SNIPPET_CHARS,
)

logger = logging.getLogger(__name__)


def _distill_prompt(query: str, url: str, text: str, perspective: str = "neutral") -> str:
    perspective_instruction = ""
    if perspective == "FOR":
        perspective_instruction = "Focus on evidence that SUPPORTS the topic/claim."
    elif perspective == "AGAINST":
        perspective_instruction = "Focus on evidence that CONTRADICTS or CHALLENGES the topic/claim."

    return f"""Extract key evidence from this web page content related to the query.

Query: {query}
URL: {url}
{perspective_instruction}

Content (first 4000 chars):
{text[:4000]}

Return ONLY valid JSON — no markdown, no explanation:
{{
  "cards": [
    {{
      "snippet": "<concise summary of the evidence, max 350 chars>",
      "quote": "<most relevant direct quote from the text, max 240 chars>",
      "claim": "<the factual claim this evidence supports or refutes, max 180 chars>",
      "confidence": <0.0 to 1.0 — how strong is this evidence?>,
      "source_type": "<academic|news|social|government|general>"
    }}
  ]
}}

Rules:
- Extract up to {MAX_CARDS_PER_URL} evidence cards.
- Each card must have a non-empty snippet, quote, and claim.
- If the page has no relevant evidence, return {{"cards": []}}.
- confidence: 0.9+ = strong/verified, 0.5 = moderate, <0.3 = weak/speculative."""


async def distill_evidence_cards(
    query: str,
    url: str,
    extracted_text: str,
    llm,
    perspective: str = "neutral",
    max_cards: int = MAX_CARDS_PER_URL,
) -> list[EvidenceCard]:
    """
    Distill evidence cards from extracted text using LLM.

    Attempts LLM extraction with one retry, then falls back to heuristic
    extraction if both attempts fail.
    """
    if not extracted_text or len(extracted_text.strip()) < 50:
        return []

    domain = ""
    title = ""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.replace("www.", "")
        title = domain
    except Exception:
        pass

    prompt = _distill_prompt(query, url, extracted_text, perspective)

    for attempt in range(2):
        try:
            import asyncio
            resp = await asyncio.to_thread(llm.invoke, prompt)
            raw = resp.content if hasattr(resp, "content") else str(resp)
            raw = raw.strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)

            match = re.search(r"\{[\s\S]*\}", raw)
            if not match:
                if attempt == 0:
                    prompt += "\n\nCRITICAL: Return ONLY valid JSON, nothing else."
                    continue
                break

            data = json.loads(match.group())
            raw_cards = data.get("cards", [])
            if not isinstance(raw_cards, list):
                break

            cards: list[EvidenceCard] = []
            for rc in raw_cards[:max_cards]:
                if not isinstance(rc, dict):
                    continue
                try:
                    card = EvidenceCard(
                        card_id=f"ev-{uuid.uuid4().hex[:8]}",
                        url=url,
                        domain=domain,
                        title=title,
                        snippet=str(rc.get("snippet", ""))[:MAX_SNIPPET_CHARS],
                        quote=str(rc.get("quote", ""))[:MAX_QUOTE_CHARS],
                        claim=str(rc.get("claim", ""))[:MAX_CLAIM_CHARS],
                        confidence=min(1.0, max(0.0, float(rc.get("confidence", 0.5)))),
                        perspective=perspective,
                        source_type=str(rc.get("source_type", "general")),
                    )
                    if card.snippet:
                        cards.append(card)
                except Exception as ve:
                    logger.debug("Card validation failed: %s", ve)
                    continue

            if cards:
                return cards
        except Exception as e:
            logger.warning("Distill attempt %d failed for %s: %s", attempt + 1, url[:60], e)
            if attempt == 0:
                prompt += "\n\nCRITICAL: Return ONLY valid JSON, nothing else."

    return _heuristic_fallback(query, url, extracted_text, domain, perspective, max_cards)


def _heuristic_fallback(
    query: str,
    url: str,
    text: str,
    domain: str,
    perspective: str,
    max_cards: int,
) -> list[EvidenceCard]:
    """Extract cards heuristically when LLM fails — sentence-level extraction."""
    sentences = re.split(r"[.!?]+", text)
    query_terms = set(query.lower().split())

    scored: list[tuple[str, float]] = []
    for sent in sentences:
        sent = sent.strip()
        if len(sent) < 30 or len(sent) > 400:
            continue
        words = set(sent.lower().split())
        overlap = len(words & query_terms)
        if overlap > 0:
            scored.append((sent, overlap / max(len(query_terms), 1)))

    scored.sort(key=lambda x: x[1], reverse=True)

    cards: list[EvidenceCard] = []
    for sent, score in scored[:max_cards]:
        cards.append(EvidenceCard(
            card_id=f"ev-{uuid.uuid4().hex[:8]}",
            url=url,
            domain=domain,
            title=domain,
            snippet=sent[:MAX_SNIPPET_CHARS],
            quote=sent[:MAX_QUOTE_CHARS],
            claim=f"Related to: {query[:100]}"[:MAX_CLAIM_CHARS],
            confidence=round(min(0.6, score), 2),
            perspective=perspective,
            source_type="general",
        ))

    return cards
