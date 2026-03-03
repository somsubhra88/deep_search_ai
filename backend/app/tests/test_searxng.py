"""
Tests for SearxNG search provider: response parsing (normalization) and provider selection.
"""

import json
import os
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app.agent import (
    _normalize_searxng_result,
    _search,
    _searxng_search,
)


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


class TestSearxNGNormalization:
    """Test that SearxNG JSON results are normalized to the common search result schema."""

    def test_normalize_searxng_result_full(self):
        item = {
            "url": "https://example.com/page",
            "title": "Example Title",
            "content": "Snippet content here.",
            "engine": "google",
            "publishedDate": "2024-01-15T10:00:00Z",
        }
        out = _normalize_searxng_result(item, "test query")
        assert out["title"] == "Example Title"
        assert out["url"] == "https://example.com/page"
        assert out["snippet"] == "Snippet content here."
        assert out["query"] == "test query"
        assert out["source"] == "searxng"
        assert out["engine"] == "google"
        assert out["published_at"] == "2024-01-15T10:00:00Z"

    def test_normalize_searxng_result_minimal(self):
        item = {"url": "https://x.com", "title": "X"}
        out = _normalize_searxng_result(item, "q")
        assert out["title"] == "X"
        assert out["url"] == "https://x.com"
        assert out["snippet"] == ""
        assert out["source"] == "searxng"
        assert out.get("engine") is None
        assert out.get("published_at") is None

    def test_normalize_from_fixture_json(self):
        fixture_path = FIXTURE_DIR / "searxng_response.json"
        if not fixture_path.exists():
            pytest.skip("Fixture not found")
        with open(fixture_path) as f:
            data = json.load(f)
        results = data.get("results", [])
        assert len(results) >= 1
        for item in results:
            out = _normalize_searxng_result(item, data.get("query", "test query"))
            assert "title" in out
            assert "url" in out
            assert "snippet" in out
            assert out["source"] == "searxng"
            assert "query" in out


class TestSearxNGProviderSelection:
    """Test that provider=searxng routes to SearxNG and returns normalized results."""

    @pytest.fixture(autouse=True)
    def env_searxng(self, monkeypatch):
        monkeypatch.setenv("SEARXNG_URL", "http://searxng:8080")

    def test_searxng_search_returns_normalized_results(self):
        fixture_path = FIXTURE_DIR / "searxng_response.json"
        if not fixture_path.exists():
            pytest.skip("Fixture not found")
        with open(fixture_path) as f:
            mock_response = json.load(f)

        with patch("app.agent._http_client") as client:
            resp = MagicMock()
            resp.json.return_value = mock_response
            resp.raise_for_status = MagicMock()
            client.get.return_value = resp

            results = _searxng_search("test query", num=5, safe_search=True)

        assert len(results) >= 1
        for r in results:
            assert r.get("source") == "searxng"
            assert "title" in r
            assert "url" in r
            assert "snippet" in r

    def test_search_provider_searxng_routes_to_searxng(self):
        """Provider selection: _search(provider='searxng') returns SearxNG-style results."""
        fixture_path = FIXTURE_DIR / "searxng_response.json"
        if not fixture_path.exists():
            pytest.skip("Fixture not found")
        with open(fixture_path) as f:
            mock_response = json.load(f)

        with patch("app.agent._http_client") as client:
            resp = MagicMock()
            resp.json.return_value = mock_response
            resp.raise_for_status = MagicMock()
            client.get.return_value = resp

            results = _search("test query", num=5, safe_search=True, provider="searxng")

        assert len(results) >= 1
        for r in results:
            assert r.get("source") == "searxng"
            assert "title" in r and "url" in r
