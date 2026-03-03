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
from urllib.parse import urlparse, urljoin
from collections import OrderedDict

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.language_models.chat_models import BaseChatModel
import httpx
from bs4 import BeautifulSoup
from app.memory_graph import store_search_memory
from app.rag.chunking import chunk_text
from app.rag.ephemeral_store import InMemoryVectorStore
from app.rerank.bm25 import BM25Reranker
from app.models.router import ModelRouter, ModelCascadeConfig
from app.schemas.evidence import EvidenceConfig, get_evidence_config
from app.schemas.explain import (
    CacheDecision,
    ExplainPayload,
    GenerationExplain,
    RetrievalExplain,
    SafetyExplain,
    TopSource,
)

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
_debug_traceback = os.getenv("DEBUG_TRACEBACK", "false").lower() in ("1", "true", "yes")

if not _ssl_verify:
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    logger.warning("SSL verification disabled - use only on trusted networks")

_http_client = httpx.Client(verify=_ssl_verify, timeout=30.0)

# ---------------------------------------------------------------------------
# Multi-Model Support
# ---------------------------------------------------------------------------

MODEL_REGISTRY = {
    "openai": {
        "label": "OpenAI",
        "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "api_key_env": "OPENAI_API_KEY",
        "base_url": None,
        "client_class": "ChatOpenAI",
    },
    "anthropic": {
        "label": "Anthropic Claude",
        "model": os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
        "api_key_env": "ANTHROPIC_API_KEY",
        "base_url": None,
        "client_class": "ChatAnthropic",
    },
    "grok": {
        "label": "xAI Grok",
        "model": os.getenv("GROK_MODEL", "grok-3"),
        "api_key_env": "GROK_API_KEY",
        "base_url": "https://api.x.ai/v1",
        "client_class": "ChatOpenAI",
    },
    "mistral": {
        "label": "Mistral AI",
        "model": os.getenv("MISTRAL_MODEL", "mistral-large-latest"),
        "api_key_env": "MISTRAL_API_KEY",
        "base_url": "https://api.mistral.ai/v1",
        "client_class": "ChatOpenAI",
    },
    "gemini": {
        "label": "Google Gemini",
        "model": os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        "api_key_env": "GEMINI_API_KEY",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "client_class": "ChatOpenAI",
    },
    "deepseek": {
        "label": "DeepSeek",
        "model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        "api_key_env": "DEEPSEEK_API_KEY",
        "base_url": "https://api.deepseek.com/v1",
        "client_class": "ChatOpenAI",
    },
    "qwen": {
        "label": "Qwen (DashScope)",
        "model": os.getenv("QWEN_MODEL", "qwen-plus"),
        "api_key_env": "QWEN_API_KEY",
        "base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "client_class": "ChatOpenAI",
    },
    "inception": {
        "label": "Inception Labs",
        "model": os.getenv("INCEPTION_MODEL", "mercury-2"),
        "api_key_env": "INCEPTION_API_KEY",
        "base_url": "https://api.inceptionlabs.ai/v1",
        "client_class": "ChatOpenAI",
    },
    "ollama": {
        "label": "Ollama Local",
        "model": os.getenv("OLLAMA_MODEL", "llama3.2"),
        "api_key_env": None,
        "base_url": os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434/v1"),
        "client_class": "ChatOpenAI",
    },
}

_llm_cache: dict[str, BaseChatModel] = {}


def clear_llm_cache() -> None:
    _llm_cache.clear()


def clear_search_cache() -> None:
    """Clear the in-memory search result cache."""
    _search_cache.clear()


def _get_llm(model_id: str = "openai", model_name: str | None = None) -> BaseChatModel:
    """Get or create an LLM instance for the given model ID."""
    cache_key = f"{model_id}:{(model_name or '').strip().lower()}"
    if cache_key in _llm_cache:
        return _llm_cache[cache_key]

    cfg = MODEL_REGISTRY.get(model_id)
    if not cfg:
        logger.warning("Unknown model_id=%s, falling back to openai", model_id)
        cfg = MODEL_REGISTRY["openai"]
        model_id = "openai"

    api_key_env = cfg.get("api_key_env")
    api_key = os.getenv(api_key_env, "") if api_key_env else ""
    if api_key_env and not api_key:
        raise RuntimeError(f"{api_key_env} is not set in .env for model {cfg['label']}")

    resolved_model = (model_name or cfg["model"]).strip()
    temperature = float(os.getenv("OPENAI_TEMPERATURE", "0.3"))

    if cfg.get("client_class") == "ChatAnthropic":
        try:
            from langchain_anthropic import ChatAnthropic
        except ImportError:
            raise RuntimeError("langchain-anthropic is required for Anthropic models. Install with: pip install langchain-anthropic")
        instance = ChatAnthropic(
            model=resolved_model,
            anthropic_api_key=api_key,
            temperature=temperature,
            max_tokens=4096,
        )
    else:
        sync_client = httpx.Client(verify=_ssl_verify, timeout=30.0)
        async_client = httpx.AsyncClient(verify=_ssl_verify, timeout=30.0)
        kwargs: dict = {
            "model": resolved_model,
            "temperature": temperature,
            "http_client": sync_client,
            "http_async_client": async_client,
        }
        if api_key:
            kwargs["openai_api_key"] = api_key
        if cfg["base_url"]:
            kwargs["base_url"] = cfg["base_url"]
        instance = ChatOpenAI(**kwargs)

    _llm_cache[cache_key] = instance
    return instance


# Default LLM for backward compatibility when available.
try:
    llm = _get_llm(os.getenv("DEFAULT_MODEL_PROVIDER", "openai"))
except Exception as _bootstrap_llm_err:
    llm = None
    logger.warning("LLM bootstrap skipped at startup: %s", _bootstrap_llm_err)

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
    "social_media": {"queries": 6, "sources": 12, "description": "social media and community signals"},
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

    def _key(self, query: str, num: int, safe: bool, provider: str = "") -> str:
        raw = f"{query.lower().strip()}|{num}|{safe}|{provider}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def get(self, query: str, num: int = 5, safe: bool = True, provider: str = "") -> list[dict] | None:
        key = self._key(query, num, safe, provider)
        if key in self._cache:
            ts, results = self._cache[key]
            if time.time() - ts < self._ttl:
                self._cache.move_to_end(key)
                self._hits += 1
                return results
            del self._cache[key]
        self._misses += 1
        return None

    def put(self, query: str, num: int, safe: bool, results: list[dict], provider: str = ""):
        key = self._key(query, num, safe, provider)
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

    def clear(self) -> None:
        """Clear all cached search results."""
        self._cache.clear()
        self._hits = 0
        self._misses = 0


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

_ACADEMIC_DOMAIN_MAP = {
    "arxiv": "arxiv.org", "scholar": "scholar.google.com",
    "pubmed": "pubmed.ncbi.nlm.nih.gov", "ieee": "ieeexplore.ieee.org",
    "nature": "nature.com", "science": "science.org",
    "springer": "link.springer.com", "jstor": "jstor.org",
    "ssrn": "ssrn.com", "semanticscholar": "semanticscholar.org",
}
_SOCIAL_DOMAIN_MAP = {
    "twitter": "twitter.com", "reddit": "reddit.com",
    "linkedin": "linkedin.com", "facebook": "facebook.com",
    "instagram": "instagram.com", "youtube": "youtube.com",
    "tiktok": "tiktok.com", "mastodon": "mastodon.social",
}
_FACTCHECK_DOMAIN_MAP = {
    "snopes": "snopes.com", "politifact": "politifact.com",
    "factcheck": "factcheck.org", "reuters": "reuters.com",
    "apnews": "apnews.com", "bbc": "bbc.com",
    "nytimes": "nytimes.com", "washpost": "washingtonpost.com",
    "guardian": "theguardian.com", "fullfact": "fullfact.org",
}


def _build_site_filter(selected_ids: list[str], domain_map: dict[str, str]) -> str:
    """Build site: filter string from selected IDs. Empty string if all selected."""
    all_ids = set(domain_map.keys())
    selected = set(selected_ids) if selected_ids else all_ids
    if selected >= all_ids:
        domains = list(domain_map.values())[:3]
    else:
        domains = [domain_map[sid] for sid in selected if sid in domain_map]
    if not domains:
        return ""
    return " OR ".join(f"site:{d}" for d in domains)


def _mode_query_instructions(mode: str, mode_settings: dict | None = None) -> str:
    """Return mode-specific instructions for query generation."""
    ms = mode_settings or {}

    if mode == "timeline":
        time_range = ms.get("timeline_range", "all")
        focus_areas = ms.get("timeline_focus", ["general"])
        range_hint = ""
        if time_range == "1y":
            range_hint = '- Append time hints like "2025-2026", "last year", "recent" to queries'
        elif time_range == "5y":
            range_hint = '- Append time hints like "2021-2026", "last 5 years" to queries'
        elif time_range == "10y":
            range_hint = '- Append time hints like "2016-2026", "last decade" to queries'
        focus_hint = ""
        if focus_areas and "general" not in focus_areas:
            focus_hint = f'- Focus on these areas: {", ".join(focus_areas)}. Weight queries toward these domains.'
        return f"""- Focus on chronological aspects: history, evolution, key dates, milestones
- Include queries like "[topic] history timeline", "[topic] evolution over years", "[topic] key milestones"
- Target date-specific searches where relevant
{range_hint}
{focus_hint}"""

    if mode == "academic":
        selected = ms.get("academic_sites", list(_ACADEMIC_DOMAIN_MAP.keys()))
        site_filter = _build_site_filter(selected, _ACADEMIC_DOMAIN_MAP)
        domains = [_ACADEMIC_DOMAIN_MAP[s] for s in selected if s in _ACADEMIC_DOMAIN_MAP][:4]
        site_directives = " ".join(f"site:{d}" for d in domains) if domains else "site:scholar.google.com site:arxiv.org"
        return f"""- Focus on scholarly and academic sources
- Include queries with "research paper", "study", "meta-analysis", "peer-reviewed"
- For at least 1-2 queries, restrict to these sites: {site_directives}
- Target scientific and academic terminology
- Preferred sources: {', '.join(domains[:6])}"""

    if mode == "fact_check":
        selected = ms.get("factcheck_sites", list(_FACTCHECK_DOMAIN_MAP.keys()))
        domains = [_FACTCHECK_DOMAIN_MAP[s] for s in selected if s in _FACTCHECK_DOMAIN_MAP][:4]
        site_directives = " ".join(f"site:{d}" for d in domains) if domains else "site:snopes.com site:factcheck.org site:politifact.com"
        return f"""- Focus on fact-checking and verification
- Include queries that seek primary sources, official statistics, original reports
- For at least 1-2 queries, restrict to these sites: {site_directives}
- Target claim-specific and evidence-based searches
- Preferred sources: {', '.join(d for d in [_FACTCHECK_DOMAIN_MAP.get(s,'') for s in selected] if d)[:200]}"""

    if mode == "deep_dive":
        depth = ms.get("deep_dive_depth", "thorough")
        include_technical = ms.get("deep_dive_include_technical", True)
        depth_map = {"moderate": "5", "thorough": "5-7", "exhaustive": "7-9"}
        q_range = depth_map.get(depth, "5-7")
        tech_hint = "\n- Include queries targeting technical papers, patents, and specifications" if include_technical else ""
        return f"""- Generate {q_range} queries covering every angle: overview, details, controversies, expert opinions, statistics, comparisons, future outlook
- Be extremely thorough and specific
- Each query should target a distinct dimension of the topic{tech_hint}
- Depth level: {depth} — {"maximum breadth and depth, leave no stone unturned" if depth == "exhaustive" else "thorough coverage of major angles" if depth == "thorough" else "focused coverage of key aspects"}"""

    if mode == "social_media":
        selected = ms.get("social_platforms", list(_SOCIAL_DOMAIN_MAP.keys()))
        domains = [_SOCIAL_DOMAIN_MAP[s] for s in selected if s in _SOCIAL_DOMAIN_MAP]
        platform_names = [s.replace("twitter", "X/Twitter").title() for s in selected if s in _SOCIAL_DOMAIN_MAP]
        site_directives = ", ".join(f"site:{d}" for d in domains[:5])
        return f"""- Focus on social media and community discussions
- Include platform-specific queries for: {', '.join(platform_names)}
- For site-restricted queries, use: {site_directives}
- Include exact-handle and hashtag variants for people/topics
- Add recency hints like "latest", "this week", and "trending" when useful"""

    return """- Each query should be distinct and target different aspects or angles
- Use specific, searchable phrases"""


async def _generate_search_queries(
    query: str, is_social: bool = False, budget: TokenBudget = None,
    mode: str = "standard", active_llm: ChatOpenAI = None,
    mode_settings: dict | None = None,
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
        mode_instructions = _mode_query_instructions(mode, mode_settings)
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
# Circuit breaker for SearxNG (avoid hammering a failing service)
# ---------------------------------------------------------------------------

class _SearxNGCircuitBreaker:
    """In-memory circuit breaker: after max_failures, open for cooldown_seconds."""

    def __init__(self, max_failures: int = 3, cooldown_seconds: float = 60.0):
        self._max_failures = max_failures
        self._cooldown = cooldown_seconds
        self._failures = 0
        self._last_failure_time: float | None = None

    def is_open(self) -> bool:
        if self._failures < self._max_failures:
            return False
        if self._last_failure_time is None:
            return False
        if time.time() - self._last_failure_time >= self._cooldown:
            self._failures = 0
            self._last_failure_time = None
            return False
        return True

    def record_success(self) -> None:
        self._failures = 0
        self._last_failure_time = None

    def record_failure(self) -> None:
        self._failures += 1
        self._last_failure_time = time.time()


_searxng_circuit = _SearxNGCircuitBreaker(
    max_failures=int(os.getenv("SEARXNG_CIRCUIT_MAX_FAILURES", "3")),
    cooldown_seconds=float(os.getenv("SEARXNG_CIRCUIT_COOLDOWN_SECONDS", "60")),
)


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


def _normalize_searxng_result(item: dict, query: str) -> dict:
    """Normalize a single SearXNG result to the common search result schema."""
    url = item.get("url") or ""
    title = item.get("title") or ""
    content = item.get("content") or ""
    engine = item.get("engine")
    published = item.get("publishedDate")
    return {
        "title": title,
        "snippet": content,
        "url": url,
        "query": query,
        "source": "searxng",
        "engine": engine,
        "published_at": published,
    }


def _searxng_search(query: str, num: int = 5, safe_search: bool = True) -> list[dict]:
    base_url = os.getenv("SEARXNG_URL", "").rstrip("/")
    if not base_url:
        raise RuntimeError("SEARXNG_URL is not set in .env")

    if _searxng_circuit.is_open():
        raise RuntimeError("SearxNG circuit breaker is open; try again later")

    timeout_sec = float(os.getenv("SEARXNG_TIMEOUT_SECONDS", "10"))
    categories = os.getenv("SEARXNG_CATEGORIES", "general")
    safesearch_val = os.getenv("SEARXNG_SAFESEARCH", "1" if safe_search else "0")
    if isinstance(safesearch_val, str) and safesearch_val.isdigit():
        safesearch_int = int(safesearch_val)
    else:
        safesearch_int = 1 if safe_search else 0

    params = {
        "q": query,
        "format": "json",
        "categories": categories,
        "safesearch": safesearch_int,
    }
    url = f"{base_url}/search"
    seen_urls: set[str] = set()
    results: list[dict] = []

    for attempt in range(2):
        try:
            resp = _http_client.get(url, params=params, timeout=timeout_sec)
            resp.raise_for_status()
            data = resp.json()
            _searxng_circuit.record_success()
            raw_results = data.get("results") or []
            for item in raw_results[: num * 2]:
                norm = _normalize_searxng_result(item, query)
                u = norm.get("url") or ""
                if u and u not in seen_urls:
                    seen_urls.add(u)
                    results.append(norm)
                    if len(results) >= num:
                        break
            return results[:num]
        except (httpx.TimeoutException, httpx.HTTPStatusError) as e:
            _searxng_circuit.record_failure()
            if attempt == 0:
                logger.warning("SearxNG request failed (attempt %s): %s", attempt + 1, e)
                continue
            raise
        except Exception as e:
            _searxng_circuit.record_failure()
            if attempt == 0:
                logger.warning("SearxNG request failed (attempt %s): %s", attempt + 1, e)
                continue
            raise
    return results


def _search(query: str, num: int = 5, safe_search: bool = True, provider: str | None = None) -> list[dict]:
    resolved = (provider or os.getenv("SEARCH_PROVIDER_DEFAULT") or os.getenv("SEARCH_PROVIDER") or "serpapi").lower()
    cached = _search_cache.get(query, num, safe_search, resolved)
    if cached is not None:
        logger.info("Cache HIT for query: %s", query[:50])
        return cached

    fallbacks_str = os.getenv("SEARCH_PROVIDER_FALLBACKS", "").strip()
    fallback_list = [p.strip().lower() for p in fallbacks_str.split(",") if p.strip()] if fallbacks_str else []
    providers_to_try = [resolved] + [p for p in fallback_list if p != resolved]

    last_error: Exception | None = None
    for prov in providers_to_try:
        try:
            if prov == "searxng":
                results = _searxng_search(query, num=num, safe_search=safe_search)
            elif prov == "tavily":
                results = _tavily_search(query, num=num)
            else:
                results = _serpapi_search(query, num=num, safe_search=safe_search)
            _search_cache.put(query, num, safe_search, results, resolved)
            return results
        except Exception as e:
            last_error = e
            logger.warning("Search provider %s failed for query %s: %s", prov, query[:50], e)
            if not fallback_list:
                raise
    if last_error is not None:
        raise last_error
    return []


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
    search_provider: str | None = None,
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
            results = await asyncio.to_thread(_search, q, num=3, safe_search=safe_search, provider=search_provider)
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

    async def _fetch_html_with_safe_redirects(initial_url: str) -> str:
        current_url = initial_url
        max_redirects = 3
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; DeepSearchAgent/1.0; +https://github.com/search-agent)",
        }

        async with httpx.AsyncClient(
            timeout=10.0, follow_redirects=False, verify=_ssl_verify
        ) as client:
            for _ in range(max_redirects + 1):
                if not _is_safe_url(current_url):
                    raise RuntimeError("Redirected to a blocked URL")

                resp = await client.get(current_url, headers=headers)

                if resp.status_code in {301, 302, 303, 307, 308}:
                    location = resp.headers.get("location")
                    if not location:
                        raise RuntimeError("Redirect location missing")
                    current_url = urljoin(current_url, location)
                    continue

                resp.raise_for_status()
                return resp.text

        raise RuntimeError("Too many redirects while scraping")

    last_err = None
    for attempt in range(retries):
        try:
            html = await _fetch_html_with_safe_redirects(url)
            soup = BeautifulSoup(html, "html.parser")
            for tag in soup(["script", "style", "nav", "header", "footer"]):
                tag.decompose()
            text = soup.get_text(separator="\n", strip=True)
            text = re.sub(r"\n{3,}", "\n\n", text)
            return text[:MAX_SCRAPE_CONTENT] if len(text) > MAX_SCRAPE_CONTENT else text
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                await asyncio.sleep(1)
    logger.warning("Failed to scrape URL after retries (%s): %s", url[:120], last_err)
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
    if mode == "social_media":
        return """
Write a SOCIAL MEDIA research report. Structure:
1. Separate verified facts from community sentiment
2. Include platform-by-platform observations (X/Twitter, Reddit, YouTube, etc.)
3. Highlight emerging narratives, influential accounts, and recurring hashtags
4. Clearly mark unverified claims and potential misinformation patterns
5. Add a "Signal vs Noise" subsection to summarize reliability
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


def _build_research_explain(
    metadata: dict,
    mode_cfg: dict,
    model_id: str,
    model_label: str,
    active_modes: list[str],
) -> dict:
    """Build structured explain payload for research complete event. No prompts or secrets."""
    cache_decision = None
    token_usage = metadata.get("token_usage") or {}
    cache_stats = token_usage.get("cache_stats") or {}
    if cache_stats:
        hits = int(cache_stats.get("hits", 0))
        misses = int(cache_stats.get("misses", 0))
        hit_rate = str(cache_stats.get("hit_rate", ""))
        cache_decision = CacheDecision(
            hit=(hits > 0),
            kind="search",
            hits=hits,
            misses=misses,
            hit_rate=hit_rate,
            why="Search results cache hit." if hits > 0 else "Search results fetched live.",
        )

    top_sources = []
    for s in (metadata.get("sources") or [])[:15]:
        top_sources.append(TopSource(
            title=(s.get("title") or "")[:200],
            url=s.get("url", ""),
            score=None,
        ))
    why_sources = f"Top {len(top_sources)} sources from web search (mode: {', '.join(active_modes)})."
    retrieval = RetrievalExplain(
        sources_considered_count=len(metadata.get("sources") or []),
        top_sources=top_sources,
        retrieval_params={
            "max_sources": mode_cfg.get("sources", 10),
            "modes": active_modes,
        },
        why_these_sources=why_sources[:500],
    )

    total_tokens = token_usage.get("total_tokens")
    generation = GenerationExplain(
        model=metadata.get("model_used", model_label),
        provider=model_id,
        prompt_version="1",
        max_tokens=total_tokens,
    )

    payload = ExplainPayload(
        cache_decision=cache_decision,
        retrieval=retrieval,
        generation=generation,
        safety=None,
    )
    return payload.model_dump()


async def run_research_agent(
    query: str,
    use_snippets_only: bool = False,
    safe_search: bool = True,
    mode: str = "standard",
    modes: list[str] | None = None,
    model_id: str = "openai",
    model_name: str | None = None,
    recalled_memories: list[dict] | None = None,
    mode_settings: dict | None = None,
    search_provider: str | None = None,
) -> AsyncGenerator[dict, None]:
    step_ctx = "unknown"
    budget = TokenBudget()

    active_modes = modes if modes else [mode]
    if not active_modes or active_modes == [""]:
        active_modes = ["standard"]

    mode_cfg = _merge_mode_configs(active_modes)
    debate_mode = "debate" in active_modes
    primary_mode = active_modes[0]

    active_llm = _get_llm(model_id, model_name=model_name)
    selected_model_name = model_name or MODEL_REGISTRY.get(model_id, {}).get("model", model_id)
    model_label = f"{MODEL_REGISTRY.get(model_id, {}).get('label', model_id)} ({selected_model_name})"

    try:
        query = _sanitize_query(query)
        if not query:
            raise ValueError("Query is empty after sanitization")

        # Step 0: Surface recalled memories (if any)
        if recalled_memories:
            yield await _emit_step(
                "memory_recall",
                f"Recalled {len(recalled_memories)} related past research session(s)",
                {"recalled_memories": recalled_memories},
            )

        # Step 1: Generate search queries
        step_ctx = "query_generation"
        modes_label = " + ".join(m.replace("_", " ").title() for m in active_modes)
        yield await _emit_step("generating_queries", f"[{model_label}] Generating queries ({modes_label})...")
        is_social = _is_social_query(query)
        queries = await _generate_search_queries(
            query, is_social=is_social, budget=budget, mode=primary_mode,
            active_llm=active_llm, mode_settings=mode_settings,
        )
        # If multiple modes, add extra mode-specific queries
        for extra_mode in active_modes[1:]:
            extra = await _generate_search_queries(
                query, is_social=is_social, budget=budget, mode=extra_mode,
                active_llm=active_llm, mode_settings=mode_settings,
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
            results = await asyncio.to_thread(_search, q, num=MAX_SOURCES_PER_SEARCH, safe_search=safe_search, provider=search_provider)
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
                results = await asyncio.to_thread(_search, q, num=MAX_SOURCES_PER_SEARCH, safe_search=safe_search, provider=search_provider)
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
        if "deep_dive" in active_modes and mode_settings and mode_settings.get("deep_dive_max_sources"):
            max_sources = max(max_sources, min(int(mode_settings["deep_dive_max_sources"]), 30))
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

        # Step 4: Build ephemeral RAG store + pre-filter with BM25
        step_ctx = "rag_indexing"
        ev_config = get_evidence_config(primary_mode)
        ephemeral_store = None
        reranker = BM25Reranker() if ev_config.use_reranking else None
        cascade_cfg = ModelCascadeConfig()
        if os.getenv("INCEPTION_API_KEY"):
            cascade_cfg.medium_model_id = "inception"
            cascade_cfg.medium_model_name = os.getenv("INCEPTION_MODEL", "mercury-2")

        model_router = ModelRouter(
            main_llm=active_llm,
            main_model_id=model_id,
            main_model_name=model_name or "",
            get_llm_fn=_get_llm,
            cascade_config=cascade_cfg,
        )

        if ev_config.use_ephemeral_rag:
            yield await _emit_step("rag_indexing", "Building search index for precise retrieval...")
            from app.rag.embeddings import get_embedder
            embedder = get_embedder()
            ephemeral_store = InMemoryVectorStore(embedder=embedder)

            for s in scraped:
                text = s.get("content", "")
                if text and len(text.strip()) > 40:
                    chunks = chunk_text(text, source_url=s.get("url", ""))
                    if reranker:
                        chunks = reranker.rerank(query, chunks)
                    ephemeral_store.add_chunks(chunks)

            yield await _emit_step("rag_indexed", f"Indexed {ephemeral_store.size} chunks from {len(scraped)} sources")

        # Step 4b: Check for map-reduce path (Deep Dive / Academic)
        step_ctx = "synthesis"
        use_map_reduce = ev_config.map_reduce_enabled and len(scraped) >= 3

        if use_map_reduce:
            yield await _emit_step("synthesizing", "Running map-reduce synthesis pipeline...")
            from app.summarize.map_reduce import map_reduce_pipeline
            map_llm = model_router.get_llm("map_summarization")
            reduce_llm = model_router.get_llm("reduce_synthesis")
            report_content = await map_reduce_pipeline(
                query=query,
                sources=scraped,
                map_llm=map_llm,
                reduce_llm=reduce_llm,
                mode=primary_mode,
            )
            budget.track("map_reduce_synthesis", f"map-reduce for {len(scraped)} sources", report_content)
        else:
            yield await _emit_step("synthesizing", "Writing report with citations...")

            if ephemeral_store and ephemeral_store.size > 0:
                top_chunks = ephemeral_store.query(
                    query,
                    top_k=ev_config.top_k_chunks,
                    max_total_chars=ev_config.max_total_context_chars,
                )
                sources_text = "\n\n---\n\n".join(
                    f"[Chunk from {c.source_url}]\n{c.text}"
                    for c in top_chunks
                )
                source_refs = "\n".join(
                    f"[Source {i+1}] {s['title']} — {s['url']}"
                    for i, s in enumerate(scraped)
                )
                sources_text += f"\n\nFull source list:\n{source_refs}"
            else:
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

            memory_context = ""
            if recalled_memories:
                essences = [m["essence"] for m in recalled_memories[:3]]
                memory_context = (
                    "\n\nNote: The user previously researched related topics. "
                    f"Past context: {'; '.join(essences)}. "
                    "Use this context to build upon prior knowledge and avoid redundancy.\n"
                )

            synthesis_prompt = f"""You are a research analyst. Synthesize the following sources into a comprehensive, well-structured Markdown report.
{memory_context}
User's topic: {query}

Sources:
{sources_text}

Instructions:{mode_instructions}{safe_instruction}"""

            synthesis_llm = model_router.get_llm("final_synthesis")
            report_resp = await asyncio.to_thread(synthesis_llm.invoke, synthesis_prompt)
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
                    extra = await asyncio.to_thread(_search, q, num=3, safe_search=safe_search, provider=search_provider)
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
                search_provider=search_provider,
            )
            metadata["confidence_matrix"] = confidence_matrix

        # Store research essence in semantic memory
        step_ctx = "memory_storage"
        essence_text = ""
        try:
            yield await _emit_step("storing_memory", "Distilling research essence into long-term memory...")
            essence_text = await store_search_memory(
                query, report_content, active_llm=active_llm,
            )
        except Exception as e:
            logger.warning("Memory storage failed (non-fatal): %s", e)

        # Attach token budget summary + model info + memory data
        metadata["token_usage"] = budget.summary
        metadata["model_used"] = model_label
        metadata["modes_used"] = active_modes
        metadata["essence_text"] = essence_text
        metadata["recalled_memories"] = recalled_memories or []

        explain = _build_research_explain(metadata, mode_cfg, model_id, model_label, active_modes)
        yield await _emit_step(
            "complete",
            "Report ready",
            {"report": report_content, "metadata": metadata, "explain": explain},
        )

    except Exception as e:
        err_detail = f"[{step_ctx}] {type(e).__name__}: {str(e)}"
        if _debug_traceback:
            tb = traceback.format_exc()
            logger.error("Agent error at step %s: %s\n%s", step_ctx, e, tb)
            raise RuntimeError(f"{err_detail}\n\nFull traceback:\n{tb}") from e
        logger.error("Agent error at step %s: %s", step_ctx, e)
        raise RuntimeError(err_detail) from e
