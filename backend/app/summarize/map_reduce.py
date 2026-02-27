"""
Hierarchical map-reduce summarization for Deep Dive & Academic modes.

Map stage:
  For each document/URL, use a cheap model to extract:
    - bullets: facts, definitions, claims, counters, citations

Reduce stage:
  Feed only those bullet summaries into the main model for final synthesis.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

MAX_MAP_INPUT_CHARS = 4_000
MAX_MAP_OUTPUT_CHARS = 1_500
MAX_REDUCE_INPUT_CHARS = 12_000
DEFAULT_MAP_PARALLELISM = 4


@dataclass
class MapResult:
    """Output of the map stage for one document."""
    source_url: str
    source_title: str
    bullets: list[str]
    raw_text: str = ""


@dataclass
class MapReduceConfig:
    map_parallelism: int = DEFAULT_MAP_PARALLELISM
    max_map_input_chars: int = MAX_MAP_INPUT_CHARS
    max_reduce_input_chars: int = MAX_REDUCE_INPUT_CHARS


def _map_prompt(query: str, title: str, url: str, text: str) -> str:
    return f"""Extract the most important information from this source relevant to the query.

Query: {query}
Source: {title} ({url})

Content (truncated):
{text[:MAX_MAP_INPUT_CHARS]}

Return ONLY a JSON object with a "bullets" array containing 3-8 bullet points.
Each bullet should be one of:
- A key fact or statistic
- A definition or explanation
- A claim with source attribution
- A counter-argument or limitation
- A relevant citation or reference

Format:
{{"bullets": ["bullet 1", "bullet 2", ...]}}

Be concise. Each bullet should be 1-2 sentences max."""


def _reduce_prompt(query: str, map_results: list[MapResult], mode: str = "deep_dive") -> str:
    sections = []
    for i, mr in enumerate(map_results):
        bullets_text = "\n".join(f"  - {b}" for b in mr.bullets)
        sections.append(f"[Source {i+1}] {mr.source_title} ({mr.source_url}):\n{bullets_text}")

    combined = "\n\n".join(sections)
    if len(combined) > MAX_REDUCE_INPUT_CHARS:
        combined = combined[:MAX_REDUCE_INPUT_CHARS] + "\n[... truncated]"

    mode_instruction = ""
    if mode == "academic":
        mode_instruction = """Write in scholarly style with:
- Abstract paragraph at the start
- Formal academic language
- Discussion of methodology and limitations where applicable
- "Further Reading" subsection"""
    elif mode == "deep_dive":
        mode_instruction = """Write an exhaustive deep-dive covering:
- Background, Current State, Key Players
- Technical Details, Controversies, Impact
- Statistics, specific examples
- Multiple perspectives
- Future Outlook"""
    else:
        mode_instruction = "Write a comprehensive, well-structured report."

    return f"""Synthesize these extracted research summaries into a comprehensive Markdown report.

Query: {query}

Extracted summaries from {len(map_results)} sources:

{combined}

Instructions:
{mode_instruction}

- Use ## for main sections and ### for subsections.
- Cite sources using [Source N] format.
- Be thorough but avoid redundancy.
- Include a References section at the end."""


async def map_stage(
    query: str,
    sources: list[dict],
    map_llm,
    config: Optional[MapReduceConfig] = None,
) -> list[MapResult]:
    """
    Map stage: parallel extraction of bullet summaries from each source.

    sources: list of dicts with keys 'title', 'url', 'content'
    map_llm: cheap/fast LLM for extraction
    """
    config = config or MapReduceConfig()
    sem = asyncio.Semaphore(config.map_parallelism)

    async def _map_one(source: dict) -> MapResult:
        title = source.get("title", "")
        url = source.get("url", "")
        content = source.get("content", "")

        if not content or len(content.strip()) < 30:
            return MapResult(source_url=url, source_title=title, bullets=[])

        async with sem:
            prompt = _map_prompt(query, title, url, content)
            try:
                resp = await asyncio.to_thread(map_llm.invoke, prompt)
                raw = resp.content if hasattr(resp, "content") else str(resp)
                raw = raw.strip()
                raw = re.sub(r"^```(?:json)?\s*", "", raw)
                raw = re.sub(r"\s*```$", "", raw)

                match = re.search(r"\{[\s\S]*\}", raw)
                if match:
                    data = json.loads(match.group())
                    bullets = data.get("bullets", [])
                    if isinstance(bullets, list):
                        bullets = [str(b)[:300] for b in bullets if b]
                        return MapResult(
                            source_url=url, source_title=title,
                            bullets=bullets[:8],
                        )
            except Exception as e:
                logger.warning("Map stage failed for %s: %s", url[:60], e)

            sentences = [s.strip() for s in re.split(r"[.!?]+", content[:2000]) if len(s.strip()) > 20]
            return MapResult(
                source_url=url, source_title=title,
                bullets=sentences[:4],
            )

    results = await asyncio.gather(*[_map_one(s) for s in sources], return_exceptions=True)
    return [
        r for r in results
        if isinstance(r, MapResult) and r.bullets
    ]


async def reduce_stage(
    query: str,
    map_results: list[MapResult],
    reduce_llm,
    mode: str = "deep_dive",
) -> str:
    """
    Reduce stage: synthesize bullet summaries into a final report.
    """
    if not map_results:
        return "No sufficient evidence found to generate a report."

    prompt = _reduce_prompt(query, map_results, mode)
    resp = await asyncio.to_thread(reduce_llm.invoke, prompt)
    content = resp.content if hasattr(resp, "content") else str(resp)
    return content.strip()


async def map_reduce_pipeline(
    query: str,
    sources: list[dict],
    map_llm,
    reduce_llm,
    mode: str = "deep_dive",
    config: Optional[MapReduceConfig] = None,
) -> str:
    """
    Full map-reduce pipeline: map all sources, then reduce into report.
    """
    map_results = await map_stage(query, sources, map_llm, config)
    report = await reduce_stage(query, map_results, reduce_llm, mode)
    return report
