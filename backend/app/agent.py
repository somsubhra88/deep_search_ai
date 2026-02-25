"""
Deep Search AI Agent - Core logic
1. Generate 3-5 specific search queries from user input
2. Execute searches via SerpAPI or Tavily
3. Scrape content of top results (or use snippets only)
4. Synthesize into structured Markdown report with citations
5. Self-reflect on report quality and suggest improvements
6. Generate follow-up research questions
7. Verify key claims across sources
"""

import os
import json
import asyncio
import re
import logging
import traceback
import time
import hashlib
import ipaddress
import socket
from typing import AsyncGenerator
from urllib.parse import urlparse
from collections import OrderedDict

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
import httpx
from bs4 import BeautifulSoup

import pathlib
_base = pathlib.Path(__file__).resolve().parents[2]
for p in [_base / ".env", pathlib.Path("/app/.env")]:
    if p.exists():
        load_dotenv(dotenv_path=p)
        break
else:
    load_dotenv()

logger = logging.getLogger(__name__)

_ssl_verify = os.getenv("SSL_VERIFY", "true").lower() not in ("0", "false", "no")

if not _ssl_verify:
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    logger.warning("SSL verification disabled - use only on trusted networks")

_http_client = httpx.Client(verify=_ssl_verify, timeout=30.0)
_http_async_client = httpx.AsyncClient(verify=_ssl_verify, timeout=30.0)

# ---------------------------------------------------------------------------
# Multi-Model Support
# ---------------------------------------------------------------------------

MODEL_REGISTRY = {
    "openai": {
        "label": "GPT-4o Mini",
        "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "api_key_env": "OPENAI_API_KEY",
        "base_url": None,
    },
    "qwen": {
        "label": "Qwen Plus",
        "model": os.getenv("QWEN_MODEL", "qwen-plus"),
        "api_key_env": "QWEN_API_KEY",
        "base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    },
}

_llm_cache: dict[str, ChatOpenAI] = {}


def _get_llm(model_id: str = "openai") -> ChatOpenAI:
    """Get or create an LLM instance for the given model ID."""
    if model_id in _llm_cache:
        return _llm_cache[model_id]

    cfg = MODEL_REGISTRY.get(model_id)
    if not cfg:
        logger.warning("Unknown model_id=%s, falling back to openai", model_id)
        cfg = MODEL_REGISTRY["openai"]
        model_id = "openai"

    api_key = os.getenv(cfg["api_key_env"], "")
    if not api_key:
        raise RuntimeError(f"{cfg['api_key_env']} is not set in .env for model {cfg['label']}")

    # Each model gets its own httpx clients so auth headers don't leak across base URLs
    sync_client = httpx.Client(verify=_ssl_verify, timeout=30.0)
    async_client = httpx.AsyncClient(verify=_ssl_verify, timeout=30.0)

    kwargs: dict = {
        "model": cfg["model"],
        "temperature": float(os.getenv("OPENAI_TEMPERATURE", "0.3")),
        "openai_api_key": api_key,
        "http_client": sync_client,
        "http_async_client": async_client,
    }
    if cfg["base_url"]:
        kwargs["base_url"] = cfg["base_url"]

    instance = ChatOpenAI(**kwargs)
    _llm_cache[model_id] = instance
    return instance


# Default LLM for backward compat
llm = _get_llm("openai")

MAX_QUERY_LENGTH = 500
MAX_SCRAPE_CONTENT = 6000
MAX_SOURCES_PER_SEARCH = 5
MAX_TOTAL_SOURCES = 10
SCRAPE_CONCURRENCY = 4

MODE_CONFIGS = {
    "standard": {"queries": 4, "sources": 10, "description": "balanced research"},
    "debate": {"queries": 4, "sources": 10, "description": "adversarial pro/con analysis"},
    "timeline": {"queries": 5, "sources": 12, "description": "chronological analysis"},
    "academic": {"queries": 5, "sources": 12, "description": "scholarly/academic focus"},
    "fact_check": {"queries": 4, "sources": 10, "description": "claim verification focus"},
    "deep_dive": {"queries": 7, "sources": 15, "description": "exhaustive deep research"},
}

# ---------------------------------------------------------------------------
# SSRF Protection
# ---------------------------------------------------------------------------

_BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def _is_safe_url(url: str) -> bool:
    """Validate URL to prevent SSRF attacks."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        blocked_hostnames = {"localhost", "metadata.google.internal"}
        if hostname in blocked_hostnames:
            return False
        try:
            resolved = socket.getaddrinfo(hostname, None)
            for _, _, _, _, sockaddr in resolved:
                ip = ipaddress.ip_address(sockaddr[0])
                if any(ip in net for net in _BLOCKED_NETWORKS):
                    return False
        except socket.gaierror:
            return False
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Search Result Cache (reduces API costs & token usage)
# ---------------------------------------------------------------------------

class SearchCache:
    """LRU cache with TTL for search results, reducing redundant API calls."""

    def __init__(self, max_size: int = 200, ttl_seconds: int = 600):
        self._cache: OrderedDict[str, tuple[float, list[dict]]] = OrderedDict()
        self._max_size = max_size
        self._ttl = ttl_seconds
        self._hits = 0
        self._misses = 0

    def _key(self, query: str, num: int, safe: bool) -> str:
        raw = f"{query.lower().strip()}|{num}|{safe}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def get(self, query: str, num: int = 5, safe: bool = True) -> list[dict] | None:
        key = self._key(query, num, safe)
        if key in self._cache:
            ts, results = self._cache[key]
            if time.time() - ts < self._ttl:
                self._cache.move_to_end(key)
                self._hits += 1
                return results
            del self._cache[key]
        self._misses += 1
        return None

    def put(self, query: str, num: int, safe: bool, results: list[dict]):
        key = self._key(query, num, safe)
        self._cache[key] = (time.time(), results)
        self._cache.move_to_end(key)
        if len(self._cache) > self._max_size:
            self._cache.popitem(last=False)

    @property
    def stats(self) -> dict:
        return {
            "hits": self._hits,
            "misses": self._misses,
            "size": len(self._cache),
            "hit_rate": f"{self._hits / max(1, self._hits + self._misses):.0%}",
        }


_search_cache = SearchCache()


# ---------------------------------------------------------------------------
# Token Budget Manager (tracks and limits LLM usage per request)
# ---------------------------------------------------------------------------

class TokenBudget:
    """Track estimated token usage across a research session."""

    COST_PER_1K_INPUT = 0.005
    COST_PER_1K_OUTPUT = 0.015

    def __init__(self, max_tokens: int = 100_000):
        self.max_tokens = max_tokens
        self.input_tokens = 0
        self.output_tokens = 0
        self._calls: list[dict] = []

    def track(self, stage: str, input_text: str, output_text: str):
        est_input = len(input_text) // 4
        est_output = len(output_text) // 4
        self.input_tokens += est_input
        self.output_tokens += est_output
        self._calls.append({
            "stage": stage,
            "input_tokens": est_input,
            "output_tokens": est_output,
        })

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def remaining(self) -> int:
        return max(0, self.max_tokens - self.total_tokens)

    @property
    def budget_exhausted(self) -> bool:
        return self.total_tokens >= self.max_tokens

    def smart_truncate(self, text: str, max_chars: int | None = None) -> str:
        """Truncate text intelligently, preserving sentence boundaries."""
        if max_chars is None:
            available = self.remaining * 4
            max_chars = min(available // 2, MAX_SCRAPE_CONTENT)
        if len(text) <= max_chars:
            return text
        truncated = text[:max_chars]
        last_period = truncated.rfind(".")
        if last_period > max_chars * 0.7:
            truncated = truncated[:last_period + 1]
        return truncated

    @property
    def summary(self) -> dict:
        return {
            "total_tokens": self.total_tokens,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "estimated_cost_usd": round(
                (self.input_tokens / 1000) * self.COST_PER_1K_INPUT
                + (self.output_tokens / 1000) * self.COST_PER_1K_OUTPUT, 4
            ),
            "budget_remaining_pct": f"{self.remaining / max(1, self.max_tokens):.0%}",
            "calls": self._calls,
            "cache_stats": _search_cache.stats,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitize_query(query: str) -> str:
    """Sanitize and validate user query input."""
    query = query.strip()
    if len(query) > MAX_QUERY_LENGTH:
        query = query[:MAX_QUERY_LENGTH]
    query = re.sub(r'[<>{}]', '', query)
    return query


def _is_social_query(query: str) -> bool:
    return bool(
        re.search(r"@[\w.]+", query)
        or re.search(r"#\w+", query)
        or re.search(r"\b(tag|username|handle)\s*[:=]\s*\S+", query, re.I)
    )


async def _emit_step(step: str, detail: str = "", data: dict = None) -> dict:
    return {"step": step, "detail": detail, "data": data or {}}


# ---------------------------------------------------------------------------
# Query Generation
# ---------------------------------------------------------------------------

def _mode_query_instructions(mode: str) -> str:
    """Return mode-specific instructions for query generation."""
    if mode == "timeline":
        return """- Focus on chronological aspects: history, evolution, key dates, milestones
- Include queries like "[topic] history timeline", "[topic] evolution over years", "[topic] key milestones"
- Target date-specific searches where relevant"""
    if mode == "academic":
        return """- Focus on scholarly and academic sources
- Include queries with "research paper", "study", "meta-analysis", "peer-reviewed"
- Add site:scholar.google.com, site:arxiv.org, site:pubmed.ncbi.nlm.nih.gov for at least 1 query
- Target scientific and academic terminology"""
    if mode == "fact_check":
        return """- Focus on fact-checking and verification
- Include queries that seek primary sources, official statistics, original reports
- Add site:snopes.com, site:factcheck.org, site:politifact.com for at least 1 query
- Target claim-specific and evidence-based searches"""
    if mode == "deep_dive":
        return """- Generate 5-7 queries covering every angle: overview, details, controversies, expert opinions, statistics, comparisons, future outlook
- Be extremely thorough and specific
- Each query should target a distinct dimension of the topic"""
    return """- Each query should be distinct and target different aspects or angles
- Use specific, searchable phrases"""


async def _generate_search_queries(
    query: str, is_social: bool = False, budget: TokenBudget = None,
    mode: str = "standard", active_llm: ChatOpenAI = None,
) -> list[str]:
    active_llm = active_llm or llm
    mode_cfg = MODE_CONFIGS.get(mode, MODE_CONFIGS["standard"])
    max_queries = mode_cfg["queries"]

    if is_social:
        prompt = f"""You are a research assistant. The user is searching for a username, hashtag, or social media tag.

Input: {query}

Generate exactly 3-5 search queries to find information about this person/tag/hashtag across the web.
- PRESERVE the exact @username or #hashtag in at least one query
- Add variations: site:twitter.com, site:instagram.com, site:linkedin.com, site:reddit.com
- Include "quotes" or profile searches
- Output ONLY a JSON array of strings. Example: ["@user site:twitter.com", "#hashtag site:instagram.com"]
"""
    else:
        mode_instructions = _mode_query_instructions(mode)
        prompt = f"""You are a research assistant. Given the user's topic below, generate exactly {max_queries} specific, focused search queries that will help find comprehensive information.

Topic: {query}

Rules:
{mode_instructions}
- Output ONLY a JSON array of strings, no other text. Example: ["query 1", "query 2", "query 3"]
"""

    response = await asyncio.to_thread(active_llm.invoke, prompt)
    content = (response.content or "").strip()
    if budget:
        budget.track("query_generation", prompt, content)

    match = re.search(r"\[.*\]", content, re.DOTALL)
    if match:
        try:
            queries = json.loads(match.group())
            if isinstance(queries, list) and len(queries) >= 1:
                return queries[:max_queries]
        except json.JSONDecodeError:
            pass
    return [query]


# ---------------------------------------------------------------------------
# Search (with caching)
# ---------------------------------------------------------------------------

def _serpapi_search(
    query: str, num: int = 5, safe_search: bool = True
) -> list[dict]:
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        raise RuntimeError("SERPAPI_API_KEY is not set in .env")

    safe_val = "active" if safe_search else os.getenv("SERPAPI_SAFE", "active")
    params = {
        "engine": "google",
        "q": query,
        "api_key": api_key,
        "gl": os.getenv("SERPAPI_GL", "us"),
        "hl": os.getenv("SERPAPI_HL", "en"),
        "num": str(num),
        "safe": safe_val,
    }

    resp = _http_client.get(
        "https://serpapi.com/search.json",
        params=params,
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()
    results = []

    for item in data.get("organic_results", [])[:num]:
        results.append({
            "title": item.get("title"),
            "snippet": item.get("snippet") or item.get("snippet_highlighted_words"),
            "url": item.get("link"),
            "query": query,
        })
    return results


def _tavily_search(query: str, num: int = 5) -> list[dict]:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        raise RuntimeError("TAVILY_API_KEY is not set in .env")

    resp = _http_client.post(
        "https://api.tavily.com/search",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "query": query,
            "search_depth": "basic",
            "max_results": num,
            "include_answer": False,
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()
    results = []

    for item in data.get("results", [])[:num]:
        results.append({
            "title": item.get("title"),
            "snippet": item.get("content") or item.get("description"),
            "url": item.get("url"),
            "query": query,
        })
    return results


def _search(query: str, num: int = 5, safe_search: bool = True) -> list[dict]:
    cached = _search_cache.get(query, num, safe_search)
    if cached is not None:
        logger.info("Cache HIT for query: %s", query[:50])
        return cached

    provider = os.getenv("SEARCH_PROVIDER", "serpapi").lower()
    if provider == "tavily":
        results = _tavily_search(query, num=num)
    else:
        results = _serpapi_search(query, num=num, safe_search=safe_search)

    _search_cache.put(query, num, safe_search, results)
    return results


# ---------------------------------------------------------------------------
# Data Void Detection
# ---------------------------------------------------------------------------

def _is_high_authority_domain(url: str) -> bool:
    if not url:
        return False
    try:
        domain = urlparse(url).netloc.lower().replace("www.", "")
        if any(tld in domain for tld in [".edu", ".gov", ".org"]):
            return True
        known = [
            "wikipedia.org", "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk",
            "nytimes.com", "theguardian.com", "nature.com", "sciencedirect.com",
            "pubmed.ncbi", "arxiv.org", "scholar.google",
        ]
        return any(k in domain for k in known)
    except Exception:
        return False


def _jaccard_similarity(a: str, b: str) -> float:
    words_a = set(re.findall(r"\w+", (a or "").lower()))
    words_b = set(re.findall(r"\w+", (b or "").lower()))
    if not words_a or not words_b:
        return 0.0
    return len(words_a & words_b) / len(words_a | words_b)


def analyze_data_void(query: str, search_results: list[dict]) -> dict:
    HIGH_AUTH_THRESHOLD = 2
    LOW_VOLUME_THRESHOLD = 3
    SEO_SIMILARITY_THRESHOLD = 0.55

    if not search_results:
        return {
            "is_data_void": True,
            "void_type": "low_volume",
            "explanation": "No search results returned. The topic may be too niche or the query may need refinement.",
        }

    high_auth_count = sum(1 for r in search_results if _is_high_authority_domain(r.get("url", "")))
    unique_domains = len(
        set(urlparse(r.get("url", "")).netloc for r in search_results if r.get("url"))
    )

    if len(search_results) < LOW_VOLUME_THRESHOLD:
        return {
            "is_data_void": True,
            "void_type": "low_volume",
            "explanation": f"Only {len(search_results)} unique result(s) found. Limited data may reduce report reliability.",
        }

    if high_auth_count < HIGH_AUTH_THRESHOLD and unique_domains < 4:
        return {
            "is_data_void": True,
            "void_type": "unverified_sources",
            "explanation": f"Few high-authority sources ({high_auth_count} of {len(search_results)}). Consider seeking .edu, .gov, or established news outlets.",
        }

    snippets = [str(r.get("snippet") or r.get("title", ""))[:500] for r in search_results]
    similarities = []
    for i in range(len(snippets)):
        for j in range(i + 1, len(snippets)):
            similarities.append(_jaccard_similarity(snippets[i], snippets[j]))
    avg_sim = sum(similarities) / len(similarities) if similarities else 0

    if avg_sim > SEO_SIMILARITY_THRESHOLD:
        return {
            "is_data_void": True,
            "void_type": "seo_spam",
            "explanation": f"Results show high similarity ({avg_sim:.0%}). May indicate echo chamber or SEO-driven content. Seek diverse sources.",
        }

    return {"is_data_void": False, "void_type": None, "explanation": "Search results passed quality checks."}


# ---------------------------------------------------------------------------
# Source Classification & Metadata
# ---------------------------------------------------------------------------

def _classify_source(url: str, title: str) -> str:
    url_lower = (url or "").lower()
    title_lower = (title or "").lower()
    if any(x in url_lower for x in [".edu", "academic", "scholar", "arxiv"]):
        return "academic"
    if any(x in url_lower for x in [".gov", "government"]):
        return "government"
    if any(x in url_lower for x in ["reddit", "twitter", "facebook", "instagram", "linkedin"]):
        return "social"
    if any(x in url_lower for x in ["wikipedia", "wikimedia"]):
        return "reference"
    if any(x in ["news", "bbc", "cnn", "reuters", "ap"] for x in [url_lower, title_lower]):
        return "news"
    return "general"


def _parse_sections_with_sources(report: str) -> list[dict]:
    sections = []
    current_section = {"heading": None, "content": "", "sources": set()}
    source_pattern = re.compile(r"\[Source (\d+)\]")

    for line in report.split("\n"):
        if line.startswith("## "):
            if current_section["content"].strip():
                sections.append({
                    "heading": current_section["heading"] or "Introduction",
                    "content": current_section["content"].strip(),
                    "sources": list(current_section["sources"]),
                })
            current_section = {"heading": line[3:].strip(), "content": "", "sources": set()}
        elif line.startswith("### "):
            if current_section["content"].strip():
                sections.append({
                    "heading": current_section["heading"] or "Introduction",
                    "content": current_section["content"].strip(),
                    "sources": list(current_section["sources"]),
                })
            current_section = {"heading": line[4:].strip(), "content": "", "sources": set()}
        elif line.strip() and not line.strip().startswith("- **["):
            current_section["content"] += line + "\n"
            for m in source_pattern.finditer(line):
                current_section["sources"].add(int(m.group(1)))

    if current_section["content"].strip():
        sections.append({
            "heading": current_section["heading"] or "Introduction",
            "content": current_section["content"].strip(),
            "sources": list(current_section["sources"]),
        })
    return sections


def _compute_graph_edges(sections: list[dict]) -> list[tuple[int, int]]:
    edges = set()
    for sec in sections:
        srcs = sorted(sec["sources"])
        for i in range(len(srcs)):
            for j in range(i + 1, len(srcs)):
                edges.add((srcs[i], srcs[j]))
    return list(edges)


async def _extract_metadata(
    report: str, scraped: list[dict], query: str, data_void: dict = None,
    budget: TokenBudget = None, active_llm: ChatOpenAI = None,
) -> dict:
    sections_parsed = _parse_sections_with_sources(report)

    sources_meta = []
    for i, s in enumerate(scraped):
        url = s.get("url", "")
        title = s.get("title", "")
        domain = ""
        try:
            domain = urlparse(url).netloc.replace("www.", "") if url else ""
        except Exception:
            pass
        sources_meta.append({
            "id": i + 1, "title": title, "url": url,
            "domain": domain, "type": _classify_source(url, title),
        })

    sections_for_llm = "\n".join(
        f"- {sec['heading']}: cites sources {sec['sources']}" for sec in sections_parsed
    )
    meta_prompt = f"""Analyze this research report and return ONLY valid JSON (no markdown).

Report sections and their cited sources:
{sections_for_llm}

For each section above, provide:
1. confidence: number of sources cited (1-5)
2. consensus: "consensus" if sources agree, "conflict" if they contradict, "single_source" if only 1 source

Also list 1-3 research gaps: what questions remain unanswered or what could be searched next.

Return JSON in this exact format:
{{"sections": [{{"heading": "...", "confidence": N, "consensus": "consensus|conflict|single_source"}}], "research_gaps": ["gap1", "gap2"]}}"""

    try:
        meta_resp = await asyncio.to_thread((active_llm or llm).invoke, meta_prompt)
        meta_content = (meta_resp.content or "").strip()
        if budget:
            budget.track("metadata", meta_prompt, meta_content)
        match = re.search(r"\{.*\}", meta_content, re.DOTALL)
        if match:
            meta_json = json.loads(match.group())
            sections_meta = meta_json.get("sections", [])
            research_gaps = meta_json.get("research_gaps", [])
        else:
            sections_meta = []
            research_gaps = []
    except Exception as e:
        logger.warning("Metadata extraction failed: %s", e)
        sections_meta = []
        research_gaps = []

    for i, sec in enumerate(sections_parsed):
        if i < len(sections_meta):
            sec["confidence"] = sections_meta[i].get("confidence", len(sec["sources"]))
            sec["consensus"] = sections_meta[i].get("consensus", "single_source" if len(sec["sources"]) <= 1 else "consensus")
        else:
            sec["confidence"] = len(sec["sources"]) or 1
            sec["consensus"] = "single_source" if len(sec["sources"]) <= 1 else "consensus"

    edges = _compute_graph_edges(sections_parsed)

    type_counts: dict[str, int] = {}
    for s in sources_meta:
        t = s["type"]
        type_counts[t] = type_counts.get(t, 0) + 1
    unique_types = len(type_counts)
    total = len(sources_meta)
    diversity_score = min(100, int((unique_types / total * 50) + (total / 2))) if total else 0

    result = {
        "sections": sections_parsed,
        "research_gaps": research_gaps,
        "sources": sources_meta,
        "graph": {"nodes": sources_meta, "edges": [{"source": a, "target": b} for a, b in edges]},
        "diversity": {
            "score": diversity_score,
            "breakdown": [{"type": t, "count": c, "value": c} for t, c in type_counts.items()],
        },
    }
    if data_void is not None:
        result["data_void"] = data_void
    return result


# ---------------------------------------------------------------------------
# Agentic Feature: Self-Reflection Loop
# ---------------------------------------------------------------------------

async def _self_reflect(
    report: str, query: str, metadata: dict, budget: TokenBudget = None,
    active_llm: ChatOpenAI = None,
) -> dict:
    """
    Critic agent evaluates the generated report for quality, bias, and gaps.
    Returns a structured assessment that can trigger a refinement pass.
    """
    reflect_prompt = f"""You are a critical research reviewer. Evaluate this report on the topic "{query}".

Report excerpt (first 3000 chars):
{report[:3000]}

Metadata:
- Sections: {len(metadata.get('sections', []))}
- Sources: {len(metadata.get('sources', []))}
- Diversity score: {metadata.get('diversity', {}).get('score', 0)}/100
- Data void detected: {metadata.get('data_void', {}).get('is_data_void', False)}

Evaluate on these dimensions and return ONLY valid JSON:
{{
  "quality_score": <1-10>,
  "factual_density": "<low|medium|high>",
  "bias_indicators": ["any detected bias patterns..."],
  "missing_perspectives": ["viewpoints not covered..."],
  "strength_points": ["what the report does well..."],
  "improvement_suggestions": ["specific improvements..."],
  "needs_refinement": <true if quality_score < 6>,
  "refinement_queries": ["additional search queries if refinement needed..."]
}}"""

    try:
        resp = await asyncio.to_thread((active_llm or llm).invoke, reflect_prompt)
        content = (resp.content or "").strip()
        if budget:
            budget.track("self_reflection", reflect_prompt, content)
        match = re.search(r"\{[\s\S]*\}", content)
        if match:
            reflection = json.loads(match.group())
            reflection.setdefault("quality_score", 5)
            reflection.setdefault("needs_refinement", False)
            return reflection
    except Exception as e:
        logger.warning("Self-reflection failed: %s", e)

    return {
        "quality_score": 5,
        "factual_density": "medium",
        "bias_indicators": [],
        "missing_perspectives": [],
        "strength_points": [],
        "improvement_suggestions": [],
        "needs_refinement": False,
        "refinement_queries": [],
    }


# ---------------------------------------------------------------------------
# Agentic Feature: Follow-Up Question Generation
# ---------------------------------------------------------------------------

async def _generate_followups(
    report: str, query: str, research_gaps: list[str], budget: TokenBudget = None,
    active_llm: ChatOpenAI = None,
) -> list[dict]:
    """
    Generate actionable follow-up research questions based on the report
    and identified gaps. Each question includes a rationale and estimated depth.
    """
    gaps_text = "\n".join(f"- {g}" for g in research_gaps[:5]) if research_gaps else "None identified"

    followup_prompt = f"""Based on this research report about "{query}" and the identified gaps below, generate 3-5 follow-up research questions the user should explore next.

Research gaps:
{gaps_text}

Report excerpt:
{report[:2000]}

For each question, provide:
- The question itself
- Why it matters (rationale)
- Expected research depth: "quick" (1-2 sources), "moderate" (3-5 sources), "deep" (5+ sources)

Return ONLY valid JSON array:
[{{"question": "...", "rationale": "...", "depth": "quick|moderate|deep"}}]"""

    try:
        resp = await asyncio.to_thread((active_llm or llm).invoke, followup_prompt)
        content = (resp.content or "").strip()
        if budget:
            budget.track("followup_generation", followup_prompt, content)
        match = re.search(r"\[[\s\S]*\]", content)
        if match:
            followups = json.loads(match.group())
            if isinstance(followups, list):
                return followups[:5]
    except Exception as e:
        logger.warning("Follow-up generation failed: %s", e)

    return []


# ---------------------------------------------------------------------------
# Agentic Feature: Claim Verification
# ---------------------------------------------------------------------------

async def _verify_claims(
    report: str, scraped: list[dict], budget: TokenBudget = None,
    active_llm: ChatOpenAI = None,
) -> list[dict]:
    """
    Extract key claims from the report and cross-reference them against
    source material. Returns verification status for each claim.
    """
    source_snippets = "\n".join(
        f"[Source {i+1}]: {s.get('content', s.get('snippet', ''))[:500]}"
        for i, s in enumerate(scraped[:8])
    )

    verify_prompt = f"""Extract the 3-5 most important factual claims from this report, then verify each against the source material provided.

Report excerpt:
{report[:2500]}

Source material:
{source_snippets}

For each claim, determine if it is:
- "verified": clearly supported by at least one source
- "partially_verified": loosely supported but not exact
- "unverified": not clearly supported by any source
- "contradicted": contradicted by source material

Return ONLY valid JSON array:
[{{"claim": "...", "status": "verified|partially_verified|unverified|contradicted", "supporting_sources": [1, 2], "note": "brief explanation"}}]"""

    try:
        resp = await asyncio.to_thread((active_llm or llm).invoke, verify_prompt)
        content = (resp.content or "").strip()
        if budget:
            budget.track("claim_verification", verify_prompt, content)
        match = re.search(r"\[[\s\S]*\]", content)
        if match:
            claims = json.loads(match.group())
            if isinstance(claims, list):
                return claims[:5]
    except Exception as e:
        logger.warning("Claim verification failed: %s", e)

    return []


# ---------------------------------------------------------------------------
# Debate Flow
# ---------------------------------------------------------------------------

async def _run_debate_flow(
    query: str, use_snippets_only: bool, safe_search: bool,
    emit_step, budget: TokenBudget = None, active_llm: ChatOpenAI = None,
) -> tuple[list[dict], list[dict], dict]:
    active_llm = active_llm or llm
    await emit_step("debate", "Agent A (Proponent): Generating queries for supporting evidence...")

    pro_prompt = f"""Generate 3 search queries to find evidence SUPPORTING or in FAVOR of this premise/topic.
Topic: {query}
Output ONLY a JSON array of strings. Example: ["X benefits", "X advantages", "evidence for X"]"""
    pro_resp = await asyncio.to_thread(active_llm.invoke, pro_prompt)
    pro_content = (pro_resp.content or "")
    if budget:
        budget.track("debate_pro_queries", pro_prompt, pro_content)
    pro_match = re.search(r"\[.*\]", pro_content, re.DOTALL)
    pro_queries = json.loads(pro_match.group())[:3] if pro_match else [f"{query} benefits", f"{query} advantages"]

    await emit_step("debate", "Agent B (Opponent): Generating queries for contradicting evidence...")

    con_prompt = f"""Generate 3 search queries to find evidence AGAINST or CONTRADICTING this premise/topic.
Topic: {query}
Output ONLY a JSON array of strings. Example: ["X drawbacks", "X criticisms", "evidence against X"]"""
    con_resp = await asyncio.to_thread(active_llm.invoke, con_prompt)
    con_content = (con_resp.content or "")
    if budget:
        budget.track("debate_con_queries", con_prompt, con_content)
    con_match = re.search(r"\[.*\]", con_content, re.DOTALL)
    con_queries = json.loads(con_match.group())[:3] if con_match else [f"{query} drawbacks", f"{query} criticisms"]

    await emit_step("debate", "Both agents searching and gathering evidence...")

    async def gather_evidence(queries: list[str]) -> list[dict]:
        all_r: list[dict] = []
        for q in queries:
            results = await asyncio.to_thread(_search, q, num=3, safe_search=safe_search)
            all_r.extend(results)
        seen: set[str] = set()
        unique = []
        for r in all_r:
            if r.get("url") and r["url"] not in seen:
                seen.add(r["url"])
                unique.append(r)

        scraped = []
        if use_snippets_only:
            for r in unique[:5]:
                scraped.append({"title": r.get("title"), "url": r.get("url", ""), "content": r.get("snippet", "") or "[No snippet]"})
        else:
            sem = asyncio.Semaphore(SCRAPE_CONCURRENCY)
            async def _scrape_one(r: dict) -> dict:
                async with sem:
                    content = await _scrape_url(r["url"]) if _is_safe_url(r.get("url", "")) else r.get("snippet", "[Blocked URL]")
                    return {"title": r.get("title"), "url": r.get("url", ""), "content": content}
            scraped = await asyncio.gather(*[_scrape_one(r) for r in unique[:5]])
        return list(scraped)

    pro_sources, con_sources = await asyncio.gather(
        gather_evidence(pro_queries), gather_evidence(con_queries),
    )

    pro_text = "\n\n".join(f"[{s['title']}]({s['url']})\n{s['content'][:1500]}" for s in pro_sources)
    con_text = "\n\n".join(f"[{s['title']}]({s['url']})\n{s['content'][:1500]}" for s in con_sources)

    await emit_step("debate", "Synthesizer: Evaluating both sides and identifying fallacies...")

    synth_prompt = f"""You are an impartial evaluator. Two agents researched the topic "{query}":
- Agent A (Proponent) found evidence SUPPORTING the premise.
- Agent B (Opponent) found evidence CONTRADICTING the premise.

PROPONENT EVIDENCE:
{pro_text}

OPPONENT EVIDENCE:
{con_text}

Analyze both. Identify logical fallacies, weak arguments, and strong points. Produce a Confidence Matrix.
Return ONLY valid JSON in this exact format (no markdown):
{{
  "pro_arguments": ["argument 1", "argument 2", ...],
  "con_arguments": ["argument 1", "argument 2", ...],
  "consensus_points": ["point both sides agree on", ...],
  "unresolved_conflicts": ["conflict 1", "conflict 2", ...]
}}"""

    synth_resp = await asyncio.to_thread(active_llm.invoke, synth_prompt)
    synth_content = (synth_resp.content or "").strip()
    if budget:
        budget.track("debate_synthesis", synth_prompt, synth_content)
    match = re.search(r"\{[\s\S]*\}", synth_content)
    if match:
        try:
            matrix = json.loads(match.group())
            if "pro_arguments" in matrix or "con_arguments" in matrix:
                return pro_sources, con_sources, matrix
        except json.JSONDecodeError:
            pass
    return pro_sources, con_sources, {
        "pro_arguments": [], "con_arguments": [],
        "consensus_points": [],
        "unresolved_conflicts": ["Synthesizer could not parse results"],
    }


# ---------------------------------------------------------------------------
# Web Scraping (with SSRF protection + parallel execution)
# ---------------------------------------------------------------------------

async def _scrape_url(url: str, retries: int = 2) -> str:
    if not _is_safe_url(url):
        logger.warning("Blocked unsafe URL: %s", url[:100])
        return "[URL blocked by security policy]"

    last_err = None
    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(
                timeout=10.0, follow_redirects=True, verify=_ssl_verify
            ) as client:
                headers = {
                    "User-Agent": "Mozilla/5.0 (compatible; DeepSearchAgent/1.0; +https://github.com/search-agent)",
                }
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "html.parser")
                for tag in soup(["script", "style", "nav", "header", "footer"]):
                    tag.decompose()
                text = soup.get_text(separator="\n", strip=True)
                text = re.sub(r"\n{3,}", "\n\n", text)
                return text[:MAX_SCRAPE_CONTENT] if len(text) > MAX_SCRAPE_CONTENT else text
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                await asyncio.sleep(1)
    return "[Content unavailable]"


# ---------------------------------------------------------------------------
# Main Research Pipeline
# ---------------------------------------------------------------------------

def _mode_synthesis_instructions(mode: str) -> str:
    """Return mode-specific synthesis prompt instructions."""
    if mode == "timeline":
        return """
Write a CHRONOLOGICAL report organized by time periods. Structure:
1. Use ## for major eras/periods and ### for specific events
2. Start from the earliest relevant date and progress forward
3. Include specific dates, years, and time references throughout
4. Highlight turning points, milestones, and pivotal moments
5. End with current state and future outlook
6. Cite each fact with [Source N] format"""
    if mode == "academic":
        return """
Write a SCHOLARLY report with academic rigor. Structure:
1. Begin with an Abstract/Summary paragraph
2. Use formal academic language and terminology
3. Organize by themes with ## and ### headings
4. Discuss methodology, findings, and limitations where applicable
5. Note consensus vs. debate in the field
6. Include a "Further Reading" subsection
7. Cite each claim with [Source N] format"""
    if mode == "fact_check":
        return """
Write a FACT-CHECK report. Structure:
1. Extract the key claims related to the topic
2. For each claim, use ### heading with the claim
3. Under each claim, provide: Evidence For, Evidence Against, and Verdict (True/Mostly True/Mixed/Mostly False/False/Unverifiable)
4. Rate overall topic reliability
5. Be extremely precise and evidence-based
6. Cite each piece of evidence with [Source N] format"""
    if mode == "deep_dive":
        return """
Write an EXHAUSTIVE deep-dive report. Structure:
1. Comprehensive overview with ## main sections
2. Cover: Background, Current State, Key Players, Technical Details, Controversies, Impact, Future Outlook
3. Include statistics, data points, and specific examples
4. Address multiple perspectives and viewpoints
5. Be thorough — aim for completeness over brevity
6. Cite each claim with [Source N] format"""
    return """
1. Write a clear, informative report with sections (use ## for main sections, ### for subsections)
2. Include relevant facts, statistics, and insights from the sources
3. Cite each claim using [Source N] format (e.g., [Source 1], [Source 3])
4. Add a "References" section at the end listing all sources with titles and URLs
5. Be objective and thorough. Use bullet points for lists."""


def _merge_mode_configs(modes: list[str]) -> dict:
    """Merge multiple mode configs, taking the max of numeric values."""
    merged = {"queries": 4, "sources": 10, "description": "standard research"}
    descriptions = []
    for m in modes:
        cfg = MODE_CONFIGS.get(m, MODE_CONFIGS["standard"])
        merged["queries"] = max(merged["queries"], cfg["queries"])
        merged["sources"] = max(merged["sources"], cfg["sources"])
        descriptions.append(cfg["description"])
    merged["description"] = " + ".join(descriptions)
    return merged


async def run_research_agent(
    query: str,
    use_snippets_only: bool = False,
    safe_search: bool = True,
    mode: str = "standard",
    modes: list[str] | None = None,
    model_id: str = "openai",
) -> AsyncGenerator[dict, None]:
    step_ctx = "unknown"
    budget = TokenBudget()

    active_modes = modes if modes else [mode]
    if not active_modes or active_modes == [""]:
        active_modes = ["standard"]

    mode_cfg = _merge_mode_configs(active_modes)
    debate_mode = "debate" in active_modes
    primary_mode = active_modes[0]

    active_llm = _get_llm(model_id)
    model_label = MODEL_REGISTRY.get(model_id, {}).get("label", model_id)

    try:
        query = _sanitize_query(query)
        if not query:
            raise ValueError("Query is empty after sanitization")

        # Step 1: Generate search queries
        step_ctx = "query_generation"
        modes_label = " + ".join(m.replace("_", " ").title() for m in active_modes)
        yield await _emit_step("generating_queries", f"[{model_label}] Generating queries ({modes_label})...")
        is_social = _is_social_query(query)
        queries = await _generate_search_queries(
            query, is_social=is_social, budget=budget, mode=primary_mode,
            active_llm=active_llm,
        )
        # If multiple modes, add extra mode-specific queries
        for extra_mode in active_modes[1:]:
            extra = await _generate_search_queries(
                query, is_social=is_social, budget=budget, mode=extra_mode,
                active_llm=active_llm,
            )
            for q in extra:
                if q not in queries:
                    queries.append(q)
            queries = queries[:mode_cfg["queries"]]
        yield await _emit_step("queries_ready", f"Generated {len(queries)} queries", {"queries": queries})

        # Step 2: Execute searches (with caching)
        step_ctx = "search"
        all_results: list[dict] = []
        for i, q in enumerate(queries):
            yield await _emit_step("searching", f"Searching for: {q[:50]}...")
            results = await asyncio.to_thread(_search, q, num=MAX_SOURCES_PER_SEARCH, safe_search=safe_search)
            all_results.extend(results)
            yield await _emit_step("search_done", f"Found {len(results)} results for query {i+1}")

        # Deduplicate by URL
        seen: set[str] = set()
        unique_results = []
        for r in all_results:
            if r.get("url") and r["url"] not in seen:
                seen.add(r["url"])
                unique_results.append(r)

        # Data void analysis
        data_void = analyze_data_void(query, unique_results)
        if data_void.get("is_data_void"):
            yield await _emit_step("data_void", f"Data quality warning: {data_void.get('void_type', 'unknown')}", {"data_void": data_void})

        # Step 2b: Adaptive depth - if data void detected, try additional queries
        if data_void.get("is_data_void") and data_void.get("void_type") == "low_volume":
            step_ctx = "adaptive_search"
            yield await _emit_step("adaptive_search", "Low results detected — running adaptive deeper search...")
            extra_queries = await _generate_search_queries(
                f"{query} comprehensive overview background information",
                is_social=is_social, budget=budget, active_llm=active_llm,
            )
            for q in extra_queries[:2]:
                results = await asyncio.to_thread(_search, q, num=MAX_SOURCES_PER_SEARCH, safe_search=safe_search)
                for r in results:
                    if r.get("url") and r["url"] not in seen:
                        seen.add(r["url"])
                        unique_results.append(r)
            data_void = analyze_data_void(query, unique_results)
            yield await _emit_step("adaptive_done", f"Adaptive search found {len(unique_results)} total unique results")

        # Step 3: Gather content (parallel scraping with SSRF protection)
        step_ctx = "content_gathering"
        scraped: list[dict] = []
        max_sources = mode_cfg.get("sources", MAX_TOTAL_SOURCES)
        targets = unique_results[:max_sources]

        if use_snippets_only:
            yield await _emit_step("scraping", "Using search snippets only (skipping web scraping)...")
            for r in targets:
                scraped.append({
                    "title": r.get("title"), "url": r.get("url", ""),
                    "snippet": r.get("snippet", ""),
                    "content": r.get("snippet", "") or "[No snippet]",
                })
        else:
            yield await _emit_step("scraping", f"Scraping content from {len(targets)} sources in parallel...")
            sem = asyncio.Semaphore(SCRAPE_CONCURRENCY)

            async def _scrape_one(r: dict) -> dict:
                url = r.get("url", "")
                async with sem:
                    if url and _is_safe_url(url):
                        content = await _scrape_url(url)
                    else:
                        content = r.get("snippet", "") or "[No content]"
                    return {
                        "title": r.get("title"), "url": url,
                        "snippet": r.get("snippet"),
                        "content": budget.smart_truncate(content),
                    }

            scraped = list(await asyncio.gather(*[_scrape_one(r) for r in targets]))
            yield await _emit_step("scraping_done", f"Scraped {len(scraped)} sources")

        # Step 4: Synthesize report (with token-aware content)
        step_ctx = "synthesis"
        yield await _emit_step("synthesizing", "Writing report with citations...")

        sources_text = "\n\n---\n\n".join(
            f"[Source {i+1}] {s['title']}\nURL: {s['url']}\n\n{budget.smart_truncate(s['content'], 3000)}"
            for i, s in enumerate(scraped)
        )

        safe_instruction = ""
        if safe_search:
            safe_instruction = "\nAlso: Exclude any adult/explicit content. Focus on professional, factual information."

        all_instructions = []
        for m in active_modes:
            inst = _mode_synthesis_instructions(m)
            if inst not in all_instructions:
                all_instructions.append(inst)
        mode_instructions = "\n".join(all_instructions)

        synthesis_prompt = f"""You are a research analyst. Synthesize the following sources into a comprehensive, well-structured Markdown report.

User's topic: {query}

Sources:
{sources_text}

Instructions:{mode_instructions}{safe_instruction}"""

        report_resp = await asyncio.to_thread(active_llm.invoke, synthesis_prompt)
        report_content = (report_resp.content or "").strip()
        budget.track("synthesis", synthesis_prompt, report_content)

        refs = "\n".join(f"- **[{i+1}]** [{s['title']}]({s['url']})" for i, s in enumerate(scraped))
        report_content += f"\n\n## References\n\n{refs}"

        # Step 5: Extract metadata
        step_ctx = "metadata"
        yield await _emit_step("metadata", "Analyzing report quality and sources...")
        metadata = await _extract_metadata(report_content, scraped, query, data_void=data_void, budget=budget, active_llm=active_llm)

        # Step 6: Self-Reflection (Critic Agent)
        step_ctx = "self_reflection"
        yield await _emit_step("self_reflection", "Critic agent evaluating report quality...")
        reflection = await _self_reflect(report_content, query, metadata, budget=budget, active_llm=active_llm)
        metadata["self_reflection"] = reflection

        # Step 6b: If reflection says refinement needed and budget allows, do a quick refinement
        if reflection.get("needs_refinement") and not budget.budget_exhausted:
            refinement_queries = reflection.get("refinement_queries", [])[:2]
            if refinement_queries:
                yield await _emit_step("refining", "Quality below threshold — running refinement pass...")
                for q in refinement_queries:
                    extra = await asyncio.to_thread(_search, q, num=3, safe_search=safe_search)
                    for r in extra:
                        if r.get("url") and r["url"] not in seen:
                            seen.add(r["url"])
                            snippet = r.get("snippet", "")
                            scraped.append({
                                "title": r.get("title"), "url": r.get("url", ""),
                                "snippet": snippet, "content": snippet or "[No snippet]",
                            })
                yield await _emit_step("refine_done", f"Added {len(refinement_queries)} refinement searches")

        # Step 7: Claim Verification
        step_ctx = "claim_verification"
        if not budget.budget_exhausted:
            yield await _emit_step("verifying_claims", "Verifying key claims against sources...")
            verified_claims = await _verify_claims(report_content, scraped, budget=budget, active_llm=active_llm)
            metadata["verified_claims"] = verified_claims

        # Step 8: Follow-Up Question Generation
        step_ctx = "followup_generation"
        if not budget.budget_exhausted:
            yield await _emit_step("generating_followups", "Generating follow-up research questions...")
            followups = await _generate_followups(
                report_content, query, metadata.get("research_gaps", []), budget=budget, active_llm=active_llm,
            )
            metadata["followup_questions"] = followups

        # Debate mode
        if debate_mode:
            step_ctx = "debate"
            _, _, confidence_matrix = await _run_debate_flow(
                query, use_snippets_only, safe_search,
                emit_step=lambda s, d: _emit_step(s, d),
                budget=budget, active_llm=active_llm,
            )
            metadata["confidence_matrix"] = confidence_matrix

        # Attach token budget summary + model info
        metadata["token_usage"] = budget.summary
        metadata["model_used"] = model_label
        metadata["modes_used"] = active_modes

        yield await _emit_step("complete", "Report ready", {"report": report_content, "metadata": metadata})

    except Exception as e:
        tb = traceback.format_exc()
        err_detail = f"[{step_ctx}] {type(e).__name__}: {str(e)}"
        logger.error("Agent error at step %s: %s\n%s", step_ctx, e, tb)
        raise RuntimeError(f"{err_detail}\n\nFull traceback:\n{tb}") from e
