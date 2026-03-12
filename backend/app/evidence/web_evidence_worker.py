"""
WebEvidenceWorker — orchestrates the full evidence collection pipeline:

1. Get URLs from SERP provider (SerpAPI/Tavily) or accept pre-supplied URLs.
2. Deduplicate by domain.
3. For each URL (async parallel with bounded concurrency):
   a. Open → snapshot → consent dismiss heuristic → extract main text
   b. Chunk text → BM25 pre-filter → embed into ephemeral store
   c. Distill evidence cards via LLM
4. Return ranked EvidenceCard list.
"""

from __future__ import annotations

import asyncio
import logging
import os
from urllib.parse import urlparse
from typing import AsyncGenerator, Optional

from app.browsing.agent_browser_cli import AgentBrowserSession
from app.evidence.distiller import distill_evidence_cards
from app.rag.chunking import chunk_text
from app.rag.ephemeral_store import InMemoryVectorStore
from app.rerank.bm25 import BM25Reranker
from app.schemas.evidence import (
    EvidenceCard,
    EvidenceCardList,
    EvidenceConfig,
    MAX_CARDS_PER_URL,
    MAX_EXTRACTED_TEXT_CHARS,
)

logger = logging.getLogger(__name__)

_URL_CONCURRENCY = int(os.getenv("EVIDENCE_URL_CONCURRENCY", "5"))
_URL_TIMEOUT = int(os.getenv("EVIDENCE_URL_TIMEOUT", "25"))


async def _process_single_url(
    url: str,
    query: str,
    perspective: str,
    llm,
    max_cards: int,
    ephemeral_store: Optional[InMemoryVectorStore],
    reranker: Optional[BM25Reranker],
) -> list[EvidenceCard]:
    """Process a single URL through the evidence pipeline."""
    session = AgentBrowserSession(timeout=_URL_TIMEOUT)
    try:
        await session.open(url)

        snapshot = await session.snapshot(interactive_only=True)
        await session.try_dismiss_consent(snapshot)

        extracted = await session.extract_main_text(max_chars=MAX_EXTRACTED_TEXT_CHARS)
        text = extracted.text

        if not text or len(text.strip()) < 50:
            return []

        if ephemeral_store is not None:
            chunks = chunk_text(text, source_url=url)
            if reranker is not None:
                chunks = reranker.rerank(query, chunks)
            ephemeral_store.add_chunks(chunks)

        cards = await distill_evidence_cards(
            query=query,
            url=url,
            extracted_text=text,
            llm=llm,
            perspective=perspective,
            max_cards=max_cards,
        )
        return cards

    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.warning("Evidence extraction failed for %s: %s", url[:60], e)
        return []
    finally:
        await session.close()


async def collect_web_evidence(
    query: str,
    urls: list[str],
    llm,
    perspective: str = "neutral",
    max_urls: int = 8,
    max_cards_per_url: int = MAX_CARDS_PER_URL,
    config: Optional[EvidenceConfig] = None,
    ephemeral_store: Optional[InMemoryVectorStore] = None,
    progress_callback: Optional[callable] = None,
) -> EvidenceCardList:
    """
    Collect evidence cards from a list of URLs.

    Args:
        query: The research query
        urls: Pre-supplied URLs (from SERP or manual)
        llm: LLM instance for distillation
        perspective: FOR / AGAINST / neutral
        max_urls: Max URLs to process
        max_cards_per_url: Max cards per URL
        config: Optional evidence configuration
        ephemeral_store: Optional shared ephemeral vector store
        progress_callback: Optional async callback(event_type, data)
    """
    if config is None:
        from app.schemas.evidence import get_evidence_config
        config = get_evidence_config("debate")

    deduped_urls = _deduplicate_by_domain(urls, max_urls)

    reranker = BM25Reranker() if config.use_reranking else None
    sem = asyncio.Semaphore(_URL_CONCURRENCY)

    async def _emit_progress(event: str, data: dict) -> None:
        if progress_callback:
            await progress_callback(event, data)

    await _emit_progress("evidence.started", {"query": query, "url_count": len(deduped_urls)})

    all_cards: list[EvidenceCard] = []

    async def _bounded_process(url: str) -> list[EvidenceCard]:
        async with sem:
            await _emit_progress("url.started", {"url": url})
            cards = await _process_single_url(
                url=url,
                query=query,
                perspective=perspective,
                llm=llm,
                max_cards=max_cards_per_url,
                ephemeral_store=ephemeral_store,
                reranker=reranker,
            )
            await _emit_progress("url.cards", {"url": url, "card_count": len(cards)})
            return cards

    tasks = [_bounded_process(u) for u in deduped_urls]

    try:
        results = await asyncio.gather(*tasks, return_exceptions=True)
    except asyncio.CancelledError:
        for t in tasks:
            if not t.done():
                t.cancel()
        raise

    for result in results:
        if isinstance(result, list):
            all_cards.extend(result)
        elif isinstance(result, Exception):
            logger.warning("URL processing exception: %s", result)

    all_cards.sort(key=lambda c: c.confidence, reverse=True)

    card_list = EvidenceCardList(
        cards=all_cards,
        query=query,
        perspective=perspective,
        total_urls_processed=len(deduped_urls),
    )

    await _emit_progress("evidence.finished", {
        "total_cards": len(all_cards),
        "total_urls": len(deduped_urls),
    })

    return card_list


def _deduplicate_by_domain(urls: list[str], max_urls: int) -> list[str]:
    """Keep at most one URL per domain, up to max_urls."""
    seen_domains: set[str] = set()
    result: list[str] = []
    for url in urls:
        domain = urlparse(url).netloc.lower().replace("www.", "")
        if domain and domain not in seen_domains:
            seen_domains.add(domain)
            result.append(url)
            if len(result) >= max_urls:
                break
    return result


async def collect_evidence_for_debate(
    query: str,
    urls: list[str],
    llm,
    perspective: str,
    ephemeral_store: Optional[InMemoryVectorStore] = None,
    config: Optional[EvidenceConfig] = None,
) -> list[EvidenceCard]:
    """Convenience wrapper for debate mode — returns flat card list."""
    result = await collect_web_evidence(
        query=query,
        urls=urls,
        llm=llm,
        perspective=perspective,
        config=config,
        ephemeral_store=ephemeral_store,
    )
    return result.cards
