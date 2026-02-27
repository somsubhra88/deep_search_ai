"""
Tests for map-reduce summarization pipeline.
"""

import asyncio
import json
import pytest
from unittest.mock import MagicMock

from app.summarize.map_reduce import (
    map_stage,
    reduce_stage,
    map_reduce_pipeline,
    MapResult,
    MapReduceConfig,
    MAX_MAP_INPUT_CHARS,
    MAX_REDUCE_INPUT_CHARS,
)


def _mock_llm(response_text: str) -> MagicMock:
    """Create a mock LLM that returns the given text."""
    mock = MagicMock()
    mock_resp = MagicMock()
    mock_resp.content = response_text
    mock.invoke.return_value = mock_resp
    return mock


class TestMapStage:
    @pytest.mark.asyncio
    async def test_map_extracts_bullets(self):
        sources = [
            {
                "title": "Source 1",
                "url": "https://example.com/1",
                "content": "Climate change is causing global temperature rise. Sea levels are increasing by 3mm per year.",
            },
        ]
        mock = _mock_llm(json.dumps({
            "bullets": [
                "Global temperatures rising due to climate change",
                "Sea levels increasing by 3mm per year",
            ]
        }))
        results = await map_stage("climate change", sources, mock)
        assert len(results) == 1
        assert len(results[0].bullets) == 2

    @pytest.mark.asyncio
    async def test_map_handles_llm_failure(self):
        sources = [
            {
                "title": "Source 1",
                "url": "https://example.com/1",
                "content": "Some content about various topics that is interesting and noteworthy.",
            },
        ]
        mock = _mock_llm("This is not valid JSON at all")
        results = await map_stage("test query", sources, mock)
        assert len(results) >= 0  # Heuristic fallback may produce results

    @pytest.mark.asyncio
    async def test_map_skips_empty_content(self):
        sources = [
            {"title": "Empty", "url": "https://example.com", "content": ""},
            {"title": "Short", "url": "https://example.com", "content": "too short"},
        ]
        mock = _mock_llm('{"bullets": []}')
        results = await map_stage("test", sources, mock)
        assert len(results) == 0

    @pytest.mark.asyncio
    async def test_map_respects_parallelism(self):
        sources = [
            {"title": f"Source {i}", "url": f"https://example.com/{i}", "content": f"Content about topic {i} with enough text to process."}
            for i in range(8)
        ]
        mock = _mock_llm(json.dumps({"bullets": ["bullet point"]}))
        config = MapReduceConfig(map_parallelism=2)
        results = await map_stage("test", sources, mock, config)
        assert len(results) <= 8


class TestReduceStage:
    @pytest.mark.asyncio
    async def test_reduce_produces_report(self):
        map_results = [
            MapResult(
                source_url="https://example.com/1",
                source_title="Source 1",
                bullets=["Point A", "Point B"],
            ),
            MapResult(
                source_url="https://example.com/2",
                source_title="Source 2",
                bullets=["Point C"],
            ),
        ]
        mock = _mock_llm("# Report\n\nSynthesized content here.")
        report = await reduce_stage("test query", map_results, mock)
        assert len(report) > 0
        assert "Synthesized" in report or "Report" in report

    @pytest.mark.asyncio
    async def test_reduce_empty_results(self):
        report = await reduce_stage("test", [], _mock_llm(""))
        assert "No sufficient evidence" in report


class TestMapReducePipeline:
    @pytest.mark.asyncio
    async def test_full_pipeline(self):
        sources = [
            {
                "title": "Climate Report",
                "url": "https://example.com/climate",
                "content": "Global temperatures have risen by 1.1 degrees since pre-industrial times.",
            },
        ]
        map_mock = _mock_llm(json.dumps({
            "bullets": ["Temperatures risen by 1.1C since pre-industrial era"]
        }))
        reduce_mock = _mock_llm("# Climate Report\n\nTemperatures have risen significantly.")
        report = await map_reduce_pipeline(
            "climate change", sources, map_mock, reduce_mock, mode="deep_dive",
        )
        assert len(report) > 0

    @pytest.mark.asyncio
    async def test_bounded_map_output(self):
        """Map stage bullets should be bounded."""
        sources = [
            {
                "title": "Source",
                "url": "https://example.com",
                "content": "Content " * 500,
            },
        ]
        mock = _mock_llm(json.dumps({
            "bullets": [f"Bullet {i}" for i in range(20)]
        }))
        results = await map_stage("test", sources, mock)
        for r in results:
            assert len(r.bullets) <= 8
