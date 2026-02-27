"""
Tests for evidence pipeline: schemas, distiller, snapshot parsing.
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.schemas.evidence import (
    EvidenceCard,
    EvidenceCardList,
    EvidenceConfig,
    ExtractedContent,
    InteractiveElement,
    PageSnapshot,
    MAX_CARDS_PER_URL,
    MAX_EXTRACTED_TEXT_CHARS,
    MAX_INTERACTIVE_ELEMENTS,
    MAX_SNIPPET_CHARS,
    MAX_QUOTE_CHARS,
    MAX_CLAIM_CHARS,
    MAX_TOTAL_CARDS,
    get_evidence_config,
)
from app.evidence.distiller import distill_evidence_cards, _heuristic_fallback


class TestEvidenceCardValidation:
    def test_card_creation_basic(self):
        card = EvidenceCard(
            url="https://example.com",
            snippet="This is evidence",
            quote="Direct quote",
            claim="Climate change is real",
            confidence=0.9,
        )
        assert card.snippet == "This is evidence"
        assert card.confidence == 0.9
        assert card.card_id.startswith("ev-")

    def test_snippet_truncation(self):
        long_snippet = "x" * 500
        card = EvidenceCard(snippet=long_snippet)
        assert len(card.snippet) <= MAX_SNIPPET_CHARS

    def test_quote_truncation(self):
        long_quote = "q" * 300
        card = EvidenceCard(quote=long_quote)
        assert len(card.quote) <= MAX_QUOTE_CHARS

    def test_claim_truncation(self):
        long_claim = "c" * 250
        card = EvidenceCard(claim=long_claim)
        assert len(card.claim) <= MAX_CLAIM_CHARS

    def test_confidence_clamped(self):
        card = EvidenceCard(confidence=0.0)
        assert card.confidence == 0.0
        card2 = EvidenceCard(confidence=1.0)
        assert card2.confidence == 1.0

    def test_confidence_out_of_range_raises(self):
        with pytest.raises(Exception):
            EvidenceCard(confidence=1.5)
        with pytest.raises(Exception):
            EvidenceCard(confidence=-0.1)


class TestEvidenceCardList:
    def test_total_cards_count(self):
        cards = [EvidenceCard(snippet=f"card {i}") for i in range(5)]
        card_list = EvidenceCardList(cards=cards, query="test")
        assert card_list.total_cards == 5

    def test_cap_cards(self):
        cards = [EvidenceCard(snippet=f"card {i}") for i in range(50)]
        card_list = EvidenceCardList(cards=cards)
        assert len(card_list.cards) <= MAX_TOTAL_CARDS


class TestPageSnapshot:
    def test_element_deduplication(self):
        elements = [
            InteractiveElement(ref="1", tag="button", text="Click"),
            InteractiveElement(ref="1", tag="button", text="Click again"),
            InteractiveElement(ref="2", tag="a", text="Link"),
        ]
        snap = PageSnapshot(url="https://example.com", elements=elements)
        assert len(snap.elements) == 2

    def test_element_cap(self):
        elements = [
            InteractiveElement(ref=str(i), tag="button", text=f"Button {i}")
            for i in range(100)
        ]
        snap = PageSnapshot(url="https://example.com", elements=elements)
        assert len(snap.elements) <= MAX_INTERACTIVE_ELEMENTS

    def test_element_text_truncation(self):
        long_text = "x" * 200
        el = InteractiveElement(ref="1", tag="button", text=long_text)
        assert len(el.text) <= 120


class TestExtractedContent:
    def test_text_cap(self):
        long_text = "a" * 10000
        ec = ExtractedContent(url="https://example.com", text=long_text)
        assert len(ec.text) <= MAX_EXTRACTED_TEXT_CHARS

    def test_char_count(self):
        ec = ExtractedContent(url="https://example.com", text="hello world")
        assert ec.char_count == 11


class TestDistillerRetryFallback:
    def test_heuristic_fallback(self):
        text = (
            "Climate change is causing global temperatures to rise. "
            "Scientists have observed a 1.1C increase since pre-industrial times. "
            "Arctic ice is melting at unprecedented rates. "
            "Sea levels continue to rise by 3mm per year."
        )
        cards = _heuristic_fallback(
            query="climate change effects",
            url="https://example.com",
            text=text,
            domain="example.com",
            perspective="neutral",
            max_cards=3,
        )
        assert len(cards) > 0
        assert all(isinstance(c, EvidenceCard) for c in cards)
        assert all(c.url == "https://example.com" for c in cards)

    def test_heuristic_with_no_matches(self):
        cards = _heuristic_fallback(
            query="quantum computing",
            url="https://example.com",
            text="This page is about cooking recipes.",
            domain="example.com",
            perspective="neutral",
            max_cards=3,
        )
        assert isinstance(cards, list)


class TestEvidenceConfig:
    def test_default_configs_exist(self):
        for mode in ["debate", "deep_dive", "academic", "fact_check", "standard"]:
            cfg = get_evidence_config(mode)
            assert isinstance(cfg, EvidenceConfig)

    def test_debate_defaults(self):
        cfg = get_evidence_config("debate")
        assert cfg.use_ephemeral_rag is True
        assert cfg.use_evidence_cards is True

    def test_unknown_mode_returns_default(self):
        cfg = get_evidence_config("unknown_mode")
        assert isinstance(cfg, EvidenceConfig)
