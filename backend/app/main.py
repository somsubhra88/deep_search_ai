"""
Deep Search AI Agent - FastAPI Backend
Streams research progress via Server-Sent Events (SSE).
Includes rate limiting, input validation, security headers, and error sanitization.
"""

import asyncio
import json
import logging
import os
import re
import time
import uuid
from collections import defaultdict
from typing import Literal, Optional
import httpx

from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from starlette.middleware.base import BaseHTTPMiddleware
from sse_starlette.sse import EventSourceResponse

import pathlib


def _resolve_env_path() -> pathlib.Path:
    base = pathlib.Path(__file__).resolve()
    candidates = [
        base.parents[2] / ".env",  # local repo layout
        base.parents[1] / ".env",  # docker image layout (/app/.env)
        pathlib.Path("/app/.env"),  # explicit fallback
    ]
    for path in candidates:
        if path.exists():
            return path
    return candidates[0]


_ENV_PATH = _resolve_env_path()
load_dotenv(dotenv_path=_ENV_PATH)

from app.agent import run_research_agent, clear_llm_cache, clear_search_cache, _get_llm, MODEL_REGISTRY, list_available_models
from app.memory_graph import recall_past_context, get_memory_graph, GRAPH_EDGE_THRESHOLD
from app.db import init_db, new_session_id, create_session, get_session, update_session_status
from app.debate_engine import DebateOrchestrator
from app.schemas.evidence import EvidenceCardList, EvidenceConfig
from app.evidence.web_evidence_worker import collect_web_evidence
from app.auth_db import init_auth_db
from app.auth_routes import router as auth_router
from app.browsing.session_manager import BrowserSessionManager
from app.kb_models import (
    init_kb_db, create_kb, list_kbs, get_kb, delete_kb,
    list_docs, delete_document,
)
from app.kb_ingest import ingest_single_file, ingest_files, ingest_zip
from app.kb_retrieval import query_rag, query_rag_stream
from app.kb_schemas import (
    KBCreateRequest, KBResponse, DocumentResponse, DocStatusItem,
    UploadResponse, RAGQueryRequest, RAGResponse,
)
from app.models.inception_client import InceptionLLMClient, InceptionConfig, ChatMessage
from app.assistant_agent import act as run_assistant_act, run_heartbeat as assistant_heartbeat
from app.executor_client import (
    approval_respond,
    events_stream_url,
    is_executor_available,
)
from app.personas import get_personas_config
from app.schemas.assistant import PersonaDefinition, SearchRecordRequest, ActionSuggestion
from app.search_bridge import save_search_run, get_search_run, generate_action_suggestions

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Rate Limiter (in-memory, per-IP, sliding window)
# ---------------------------------------------------------------------------

class RateLimiter:
    """Simple sliding-window rate limiter. Per-IP tracking."""

    def __init__(
        self, max_requests: int = 10, window_seconds: int = 60, max_clients: int = 5000
    ):
        self.max_requests = max_requests
        self.window = window_seconds
        self.max_clients = max_clients
        self._requests: dict[str, list[float]] = defaultdict(list)

    def _prune(self, now: float) -> None:
        stale_clients = []
        for client_ip, timestamps in self._requests.items():
            active = [t for t in timestamps if now - t < self.window]
            if active:
                self._requests[client_ip] = active
            else:
                stale_clients.append(client_ip)

        for client_ip in stale_clients:
            self._requests.pop(client_ip, None)

    def is_allowed(self, client_ip: str) -> bool:
        now = time.time()
        self._prune(now)
        is_new_client = client_ip not in self._requests
        if is_new_client and len(self._requests) >= self.max_clients:
            return False

        timestamps = self._requests.get(client_ip, [])
        self._requests[client_ip] = [t for t in timestamps if now - t < self.window]

        if len(self._requests[client_ip]) >= self.max_requests:
            return False
        self._requests[client_ip].append(now)
        return True

    def remaining(self, client_ip: str) -> int:
        now = time.time()
        self._prune(now)
        active = self._requests.get(client_ip, [])
        return max(0, self.max_requests - len(active))


_rate_limiter = RateLimiter(max_requests=10, window_seconds=60)


# ---------------------------------------------------------------------------
# Security Headers Middleware
# ---------------------------------------------------------------------------

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


# ---------------------------------------------------------------------------
# App Setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Deep Search AI Agent",
    description="AI-powered research agent with live progress streaming",
    version="0.2.0",
)

app.add_middleware(SecurityHeadersMiddleware)

# Include authentication router
app.include_router(auth_router)

_frontend_port = os.getenv("FRONTEND_PORT", "3000")
_cors_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://frontend:3000",
]
if _frontend_port not in ("3000", "3001"):
    _cors_origins.extend([
        f"http://localhost:{_frontend_port}",
        f"http://127.0.0.1:{_frontend_port}",
    ])
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


# ---------------------------------------------------------------------------
# Request Validation
# ---------------------------------------------------------------------------

VALID_MODES = {
    "standard",
    "debate",
    "timeline",
    "academic",
    "fact_check",
    "deep_dive",
    "social_media",
    "rag",
}
VALID_MODELS = {"openai", "anthropic", "grok", "mistral", "gemini", "deepseek", "qwen", "ollama", "inception", "openrouter"}
VALID_SEARCH_PROVIDERS = {"serpapi", "tavily", "searxng"}
VALID_EMBEDDING_PROVIDERS = {"openai", "openrouter", "ollama", "hash", "auto"}
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "false").lower() in {"1", "true", "yes"}
_TRUSTED_PROXY_IPS = {
    ip.strip()
    for ip in os.getenv("TRUSTED_PROXY_IPS", "127.0.0.1,::1").split(",")
    if ip.strip()
}


class ResearchRequest(BaseModel):
    query: str
    use_snippets_only: bool = False
    safe_search: bool = True
    modes: list[str] = ["standard"]
    model_id: str = os.getenv("DEFAULT_MODEL_PROVIDER", "openai")
    model_name: str | None = None
    mode_settings: dict | None = None
    search_provider: str | None = None
    linked_context: list[dict] | None = None

    @field_validator("query")
    @classmethod
    def validate_query(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Query cannot be empty")
        if len(v) > 500:
            raise ValueError("Query must be under 500 characters")
        if len(v) < 2:
            raise ValueError("Query must be at least 2 characters")
        return v

    @field_validator("modes")
    @classmethod
    def validate_modes(cls, v: list[str]) -> list[str]:
        if not v:
            return ["standard"]
        for m in v:
            if m not in VALID_MODES:
                raise ValueError(f"Invalid mode '{m}'. Must be one of: {', '.join(VALID_MODES)}")
        return v

    @field_validator("model_id")
    @classmethod
    def validate_model(cls, v: str) -> str:
        if v not in VALID_MODELS:
            raise ValueError(f"Invalid model. Must be one of: {', '.join(VALID_MODELS)}")
        return v

    @field_validator("search_provider")
    @classmethod
    def validate_search_provider(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if v.strip() == "":
            return None
        v = v.strip().lower()
        if v not in VALID_SEARCH_PROVIDERS:
            raise ValueError(
                f"Invalid search_provider. Must be one of: {', '.join(sorted(VALID_SEARCH_PROVIDERS))}"
            )
        return v


class SetupRequest(BaseModel):
    llm_provider: str
    llm_model: str
    llm_api_key: str | None = None
    ollama_base_url: str | None = None
    search_provider: str
    search_api_key: str
    embedding_provider: str | None = None
    embedding_model: str | None = None
    embedding_api_key: str | None = None

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, v: str) -> str:
        if v not in VALID_MODELS:
            raise ValueError(f"Invalid llm_provider. Must be one of: {', '.join(VALID_MODELS)}")
        return v

    @field_validator("embedding_provider")
    @classmethod
    def validate_embedding_provider(cls, v: str | None) -> str | None:
        if v and v not in VALID_EMBEDDING_PROVIDERS:
            raise ValueError(f"Invalid embedding_provider. Must be one of: {', '.join(VALID_EMBEDDING_PROVIDERS)}")
        return v

    @field_validator("llm_model")
    @classmethod
    def validate_llm_model(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("llm_model cannot be empty")
        if len(v) > 120:
            raise ValueError("llm_model is too long")
        return v

    @field_validator("search_provider")
    @classmethod
    def validate_search_provider(cls, v: str) -> str:
        if v not in VALID_SEARCH_PROVIDERS:
            raise ValueError(
                f"Invalid search_provider. Must be one of: {', '.join(VALID_SEARCH_PROVIDERS)}"
            )
        return v

    @field_validator("search_api_key")
    @classmethod
    def validate_search_api_key(cls, v: str, info) -> str:
        v = v.strip() if v else ""
        if not v and info.data.get("search_provider") != "searxng":
            raise ValueError("search_api_key cannot be empty")
        return v

    @field_validator("llm_api_key")
    @classmethod
    def validate_llm_api_key(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("ollama_base_url")
    @classmethod
    def validate_ollama_base_url(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


def _get_client_ip(request: Request) -> str:
    client_host = request.client.host if request.client else "unknown"

    # Only trust forwarding headers from known reverse proxies.
    forwarded = request.headers.get("X-Forwarded-For")
    if TRUST_PROXY_HEADERS and forwarded and client_host in _TRUSTED_PROXY_IPS:
        return forwarded.split(",")[0].strip()
    return client_host


def _sanitize_error(error: str) -> str:
    """Remove sensitive information from error messages before sending to client."""
    sensitive_patterns = [
        (r"sk-[a-zA-Z0-9_-]{20,}", "[REDACTED_API_KEY]"),
        (r"Bearer [a-zA-Z0-9_-]+", "Bearer [REDACTED]"),
        (r"/Users/[^\s]+", "[REDACTED_PATH]"),
        (r"/home/[^\s]+", "[REDACTED_PATH]"),
        (r"/app/[^\s]+\.py", "[internal]"),
    ]
    for pattern, replacement in sensitive_patterns:
        error = re.sub(pattern, replacement, error)
    return error


def _upsert_env_values(env_path: pathlib.Path, updates: dict[str, str]) -> None:
    env_path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text().splitlines()

    updated = set()
    result: list[str] = []
    key_patterns = {key: re.compile(rf"^\s*{re.escape(key)}\s*=") for key in updates}

    for line in lines:
        replaced = False
        for key, pattern in key_patterns.items():
            if pattern.match(line):
                result.append(f"{key}={updates[key]}")
                updated.add(key)
                replaced = True
                break
        if not replaced:
            result.append(line)

    missing = [k for k in updates.keys() if k not in updated]
    if missing:
        if result and result[-1].strip():
            result.append("")
        for key in missing:
            result.append(f"{key}={updates[key]}")

    env_path.write_text("\n".join(result) + "\n")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.2.0"}


# ---------------------------------------------------------------------------
# Command palette (GET /api/commands, POST /api/cache/clear)
# ---------------------------------------------------------------------------

class CommandActionRoute(BaseModel):
    type: Literal["route"] = "route"
    path: str


class CommandActionToggle(BaseModel):
    type: Literal["toggle"] = "toggle"
    key: str


class CommandActionSearchFocus(BaseModel):
    type: Literal["search_focus"] = "search_focus"


class CommandActionAssistantNewChat(BaseModel):
    type: Literal["assistant_new_chat"] = "assistant_new_chat"


class CommandActionClearHistory(BaseModel):
    type: Literal["clear_history"] = "clear_history"


class CommandActionOpenPersona(BaseModel):
    type: Literal["open_persona"] = "open_persona"
    persona_id: str


class CommandActionClearCache(BaseModel):
    type: Literal["clear_cache"] = "clear_cache"


CommandAction = (
    CommandActionRoute
    | CommandActionToggle
    | CommandActionSearchFocus
    | CommandActionAssistantNewChat
    | CommandActionClearHistory
    | CommandActionOpenPersona
    | CommandActionClearCache
)


class CommandItem(BaseModel):
    id: str
    title: str
    subtitle: Optional[str] = None
    icon_key: Optional[str] = None
    group: str
    shortcut: Optional[str] = None
    action: dict  # One of the CommandAction variants as dict for JSON


def _build_commands_list() -> list[dict]:
    """Build schema-driven command list for the palette. Add new commands here or from config."""
    personas = get_personas_config()
    persona_commands = [
        {
            "id": f"persona_{p['persona_id']}",
            "title": p["display_name"],
            "subtitle": p.get("description", ""),
            "icon_key": p.get("icon_key", "zap"),
            "group": "Personas",
            "shortcut": None,
            "action": {"type": "open_persona", "persona_id": p["persona_id"]},
        }
        for p in personas
    ]
    # Shortcuts use ⌘ on Mac; frontend shows Ctrl+ on Windows/Linux
    return [
        {"id": "nav_search", "title": "Go to Search", "subtitle": "Open search page", "icon_key": "search", "group": "Navigation", "shortcut": "⌘1", "action": {"type": "route", "path": "/search"}},
        {"id": "nav_assistant", "title": "Go to Assistant", "subtitle": "Open assistant chat", "icon_key": "messageCircle", "group": "Navigation", "shortcut": "⌘2", "action": {"type": "route", "path": "/assistant"}},
        {"id": "toggle_explain", "title": "Toggle Explain mode", "subtitle": "Show/hide explain panel", "icon_key": "helpCircle", "group": "Toggles", "shortcut": "⌘E", "action": {"type": "toggle", "key": "explain_mode"}},
        {"id": "toggle_snippets", "title": "Toggle Snippets only", "subtitle": "Use snippets only for search", "icon_key": "fileText", "group": "Toggles", "shortcut": None, "action": {"type": "toggle", "key": "snippets_only"}},
        {"id": "toggle_safe_search", "title": "Toggle Safe search", "subtitle": "Filter safe search", "icon_key": "shield", "group": "Toggles", "shortcut": None, "action": {"type": "toggle", "key": "safe_search"}},
        {"id": "action_search_focus", "title": "New Search", "subtitle": "Focus search input", "icon_key": "search", "group": "Actions", "shortcut": "⌘L", "action": {"type": "search_focus"}},
        {"id": "action_new_chat", "title": "New Assistant Chat", "subtitle": "Start a new chat", "icon_key": "plus", "group": "Actions", "shortcut": "⌘N", "action": {"type": "assistant_new_chat"}},
        {"id": "action_clear_history", "title": "Clear history", "subtitle": "Clear search and assistant history (local)", "icon_key": "trash2", "group": "Actions", "shortcut": None, "action": {"type": "clear_history"}},
        {"id": "cache_clear", "title": "Clear cache", "subtitle": "Clear backend search and LLM caches", "icon_key": "trash2", "group": "Cache", "shortcut": None, "action": {"type": "clear_cache"}},
    ] + persona_commands


@app.get("/api/commands")
async def get_commands():
    """Return command palette entries. Schema-driven; add new commands in _build_commands_list or via config."""
    return _build_commands_list()


@app.post("/api/cache/clear")
async def clear_cache():
    """Clear in-memory LLM and search caches. Safe to call; no user data cleared."""
    clear_llm_cache()
    clear_search_cache()
    return {"status": "ok", "message": "Cache cleared"}


@app.get("/api/providers")
async def list_providers():
    providers = []
    for pid, cfg in MODEL_REGISTRY.items():
        configured = bool(cfg.get("api_key_env") and os.getenv(cfg["api_key_env"]))
        providers.append(
            {
                "provider": pid,
                "label": cfg.get("label", pid),
                "models": [cfg.get("model")] if cfg.get("model") else [],
                "supports_streaming": False if pid == "inception" else True,
                "description": "Inception Labs mercury-2" if pid == "inception" else cfg.get("label", pid),
                "configured": configured,
            }
        )
    return providers


@app.get("/api/ollama/models")
async def list_ollama_models():
    """Return list of model names from local Ollama (GET /api/tags). Updates automatically when you pull new models."""
    base_url = (os.getenv("OLLAMA_BASE_URL") or "http://host.docker.internal:11434/v1").rstrip("/")
    if base_url.endswith("/v1"):
        base_url = base_url[:-3]
    tags_url = f"{base_url}/api/tags"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(tags_url)
            r.raise_for_status()
            data = r.json()
    except (httpx.HTTPError, json.JSONDecodeError, KeyError) as e:
        logger.debug("Ollama models fetch failed: %s", e)
        return {"models": []}
    models = data.get("models") or []
    names = [m.get("name") for m in models if isinstance(m, dict) and m.get("name")]
    return {"models": names}


@app.get("/api/models/{provider_id}")
async def list_provider_models(provider_id: str, api_key: Optional[str] = None):
    """
    Dynamically fetch available models from a provider's API.
    Query parameter 'api_key' is optional - uses env var if not provided.
    """
    if provider_id not in MODEL_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found")

    models = await asyncio.to_thread(list_available_models, provider_id, api_key)
    return {"provider": provider_id, "models": models}


@app.post("/api/providers/inception/test")
async def test_inception_provider():
    api_key = os.getenv("INCEPTION_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="INCEPTION_API_KEY is not set on the backend.")

    base_url = os.getenv("INCEPTION_BASE_URL", "https://api.inceptionlabs.ai/v1")
    model_name = os.getenv("INCEPTION_MODEL", "mercury-2")

    try:
        config = InceptionConfig(provider="inception", api_key=api_key, base_url=base_url)
    except Exception as e:  # pydantic validation errors
        raise HTTPException(status_code=400, detail=f"Invalid Inception configuration: {e}")

    client = InceptionLLMClient(config)
    try:
        result = await client.chat_completion(
            [ChatMessage(role="user", content="Ping from Deep Search AI agent. Reply with 'pong'.")],
            model=model_name or "mercury-2",
        )
    except httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code if e.response else 502, detail=f"Inception API error: {detail}")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Inception request failed: {e}")

    preview = (result.content or "").strip()[:200]
    return {
        "status": "ok",
        "model": result.model,
        "configured": True,
        "preview": preview,
    }


@app.post("/api/setup")
async def setup_runtime_config(body: SetupRequest):
    env_updates: dict[str, str] = {
        "SEARCH_PROVIDER": body.search_provider,
        "DEFAULT_MODEL_PROVIDER": body.llm_provider,
    }

    if body.search_provider == "serpapi":
        env_updates["SERPAPI_API_KEY"] = body.search_api_key
    elif body.search_provider == "tavily":
        env_updates["TAVILY_API_KEY"] = body.search_api_key
    elif body.search_provider == "searxng":
        pass

    _PROVIDER_ENV_MAP = {
        "openai":     {"model_env": "OPENAI_MODEL",     "key_env": "OPENAI_API_KEY"},
        "anthropic":  {"model_env": "ANTHROPIC_MODEL",  "key_env": "ANTHROPIC_API_KEY"},
        "grok":       {"model_env": "GROK_MODEL",       "key_env": "GROK_API_KEY"},
        "mistral":    {"model_env": "MISTRAL_MODEL",    "key_env": "MISTRAL_API_KEY"},
        "gemini":     {"model_env": "GEMINI_MODEL",     "key_env": "GEMINI_API_KEY"},
        "deepseek":   {"model_env": "DEEPSEEK_MODEL",   "key_env": "DEEPSEEK_API_KEY"},
        "qwen":       {"model_env": "QWEN_MODEL",       "key_env": "QWEN_API_KEY"},
        "inception":  {"model_env": "INCEPTION_MODEL",  "key_env": "INCEPTION_API_KEY"},
        "openrouter": {"model_env": "OPENROUTER_MODEL", "key_env": "OPENROUTER_API_KEY"},
    }

    if body.llm_provider == "ollama":
        env_updates["OLLAMA_MODEL"] = body.llm_model
        env_updates["OLLAMA_BASE_URL"] = body.ollama_base_url or "http://host.docker.internal:11434/v1"
    elif body.llm_provider in _PROVIDER_ENV_MAP:
        mapping = _PROVIDER_ENV_MAP[body.llm_provider]
        env_updates[mapping["model_env"]] = body.llm_model
        if not body.llm_api_key:
            raise HTTPException(status_code=400, detail=f"llm_api_key is required for {body.llm_provider}")
        env_updates[mapping["key_env"]] = body.llm_api_key
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {body.llm_provider}")

    # Configure embedding provider if specified
    if body.embedding_provider and body.embedding_provider not in ("auto", "hash"):
        env_updates["EMBEDDING_PROVIDER"] = body.embedding_provider
        if body.embedding_model:
            env_updates["EMBEDDING_MODEL"] = body.embedding_model
        if body.embedding_api_key:
            if body.embedding_provider == "openai":
                # Use same key as LLM if not specified separately
                if not env_updates.get("OPENAI_API_KEY"):
                    env_updates["OPENAI_API_KEY"] = body.embedding_api_key
            elif body.embedding_provider == "openrouter":
                env_updates["OPENROUTER_EMBEDDING_KEY"] = body.embedding_api_key

    persisted = True
    try:
        _upsert_env_values(_ENV_PATH, env_updates)
    except Exception as e:
        persisted = False
        logger.warning("Could not persist setup to .env (%s): %s", _ENV_PATH, e)

    # Apply immediately for this running backend process.
    for key, value in env_updates.items():
        os.environ[key] = value

    clear_llm_cache()
    logger.info(
        "Runtime setup updated [provider=%s, search=%s]",
        body.llm_provider,
        body.search_provider,
    )
    return {
        "status": "ok",
        "message": "Configuration saved" if persisted else "Runtime configuration applied (persistence unavailable)",
    }


@app.post("/api/research")
async def research(request: Request, body: ResearchRequest):
    client_ip = _get_client_ip(request)

    if not _rate_limiter.is_allowed(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Please wait before making another request.",
        )

    query = body.query
    use_snippets_only = body.use_snippets_only
    safe_search = body.safe_search
    modes = body.modes
    model_id = body.model_id
    model_name = body.model_name

    logger.info(
        "Research request from %s [%s|%s]: %s",
        client_ip,
        model_id,
        "+".join(modes),
        query[:80],
    )

    recalled_memories: list[dict] = []
    try:
        recalled_memories = await recall_past_context(query)
        if recalled_memories:
            logger.info("Recalled %d past memories for: %s", len(recalled_memories), query[:50])
    except Exception as e:
        logger.warning("Memory recall failed (non-fatal): %s", e)

    # Merge manually linked context from the client's graph
    if body.linked_context:
        existing_queries = {m.get("query", "").strip().lower() for m in recalled_memories}
        for lc in body.linked_context:
            q_norm = lc.get("query", "").strip().lower()
            if q_norm and q_norm not in existing_queries:
                recalled_memories.append({
                    "query": lc.get("query", ""),
                    "essence": lc.get("essence", ""),
                    "timestamp": lc.get("timestamp", ""),
                    "similarity": 1.0,
                })
                existing_queries.add(q_norm)
        logger.info("After merging linked context: %d total memories", len(recalled_memories))

    async def event_generator():
        try:
            async for event in run_research_agent(
                query,
                use_snippets_only=use_snippets_only,
                safe_search=safe_search,
                modes=modes,
                model_id=model_id,
                model_name=model_name,
                recalled_memories=recalled_memories,
                mode_settings=body.mode_settings,
                search_provider=body.search_provider,
            ):
                if await request.is_disconnected():
                    logger.info("Client disconnected, stopping research")
                    break
                yield {"event": "progress", "data": json.dumps(event)}
        except Exception as e:
            err_msg = _sanitize_error(str(e))
            logger.exception("Research failed for %s: %s", client_ip, err_msg)
            yield {"event": "error", "data": json.dumps({"error": err_msg})}

    return EventSourceResponse(event_generator())


# ---------------------------------------------------------------------------
# Memory Graph API
# ---------------------------------------------------------------------------

@app.get("/api/memory/graph")
async def memory_graph_endpoint(threshold: float = GRAPH_EDGE_THRESHOLD):
    """Return all stored memories with pairwise cosine similarity edges computed from embeddings."""
    return get_memory_graph(threshold=threshold)


# ---------------------------------------------------------------------------
# Search → Assistant Bridge
# ---------------------------------------------------------------------------

@app.post("/api/search/record")
async def search_record(body: SearchRecordRequest):
    """Store minimal search run for bridge and assistant reference."""
    save_search_run(
        search_id=body.id,
        query=body.query,
        created_at=body.created_at,
        mode=body.mode,
        provider=body.provider,
        model=body.model,
        perspective=body.perspective,
        citations=body.citations,
        summary_snippet=body.summary_snippet,
    )
    return {"status": "ok", "search_id": body.id}


class ActionSuggestionsRequest(BaseModel):
    perspective_dial: int = Field(default=50, ge=0, le=100)
    modes: list[str] = Field(default_factory=list)
    model_id: str = Field(default_factory=lambda: os.getenv("DEFAULT_MODEL_PROVIDER", "openai"))


@app.post("/api/search/{search_id}/action_suggestions", response_model=list[ActionSuggestion])
async def action_suggestions(search_id: str, body: ActionSuggestionsRequest):
    """Generate 4–8 context-aware action suggestions for this search run (LLM, no hardcoded list)."""
    if not get_search_run(search_id):
        raise HTTPException(status_code=404, detail="Search run not found")
    suggestions = await generate_action_suggestions(
        search_id=search_id,
        perspective_dial=body.perspective_dial,
        modes=body.modes or [],
        model_id=body.model_id,
    )
    return [ActionSuggestion(**s) for s in suggestions]


# ---------------------------------------------------------------------------
# Assistant Actions (executor-backed, real actions)
# ---------------------------------------------------------------------------

class AssistantActRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    run_id: str | None = None
    context: dict | None = None
    model_id: str = Field(default_factory=lambda: os.getenv("DEFAULT_MODEL_PROVIDER", "openai"))
    persona_id: str | None = Field(None, description="Active persona; influences system prompt and tool priority")
    selected_context_ids: list[str] | None = Field(None, description="Optional context refs (e.g. session ids) to include")


class AssistantApproveRequest(BaseModel):
    approval_id: str
    decision: Literal["approve", "deny"] = "approve"
    save_rule: dict | None = None


@app.get("/api/assistant/status")
async def assistant_status():
    """Check if executor is available for real actions."""
    return {"executor_available": is_executor_available()}


@app.get("/api/assistant/personas", response_model=list[PersonaDefinition])
async def assistant_personas(
    email_connected: bool = False,
    calendar_connected: bool = False,
):
    """
    Return persona definitions with status. Frontend renders sidebar from this only.
    Status is computed from backend executor and optional connector query params.
    """
    executor_available = is_executor_available()
    # Optional: allow query params from query string (e.g. ?email_connected=true)
    # Query params are already parsed above
    personas_raw = get_personas_config()
    result: list[PersonaDefinition] = []
    for p in personas_raw:
        requires = p.get("requires_setup") or []
        caps = p.get("capabilities") or []
        if not requires:
            if "actions" in caps and not executor_available:
                status = "needs_setup"
            else:
                status = "ready"
        else:
            need_email = "email" in requires
            need_calendar = "calendar" in requires
            if need_email and need_calendar:
                status = "connected" if (email_connected and calendar_connected) else "needs_setup"
            elif need_email:
                status = "connected" if email_connected else "needs_setup"
            elif need_calendar:
                status = "connected" if calendar_connected else "needs_setup"
            else:
                status = "ready"
        result.append(
            PersonaDefinition(
                persona_id=p["persona_id"],
                display_name=p["display_name"],
                icon_key=p["icon_key"],
                description=p["description"],
                example_prompts=p.get("example_prompts") or [],
                capabilities=p.get("capabilities") or [],
                requires_setup=requires,
                status=status,
                last_activity_at=None,
            )
        )
    return result


@app.post("/api/assistant/act")
async def assistant_act(body: AssistantActRequest):
    """
    Take real action based on user message.
    Uses LLM to pick tool, executes via local executor.
    Persona influences system prompt and tool priority.
    """
    run_id = body.run_id or str(uuid.uuid4())
    try:
        result = await run_assistant_act(
            message=body.message,
            run_id=run_id,
            context=body.context,
            model_id=body.model_id,
            persona_id=body.persona_id,
            selected_context_ids=body.selected_context_ids,
        )
        return result
    except Exception as e:
        logger.exception("assistant act failed: %s", e)
        raise HTTPException(status_code=500, detail=_sanitize_error(str(e)))


@app.post("/api/assistant/approve")
async def assistant_approve(body: AssistantApproveRequest):
    """Respond to a pending approval (approve or deny destructive action)."""
    try:
        result = await approval_respond(
            approval_id=body.approval_id,
            decision=body.decision,
            save_rule=body.save_rule,
        )
        return result
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail=e.response.text[:500] if e.response else str(e),
        )
    except Exception as e:
        logger.exception("assistant approve failed: %s", e)
        raise HTTPException(status_code=500, detail=_sanitize_error(str(e)))


class AssistantHeartbeatRequest(BaseModel):
    """Context sent by the client for heartbeat (pending_tasks, events_today, etc.)."""
    context: dict | None = None
    model_id: str = Field(default_factory=lambda: os.getenv("DEFAULT_MODEL_PROVIDER", "openai"))


@app.post("/api/assistant/heartbeat")
async def assistant_heartbeat_route(body: AssistantHeartbeatRequest):
    """
    Run an autonomous heartbeat check (OpenClaw-style).
    Client sends context (e.g. pending_tasks, events_today); LLM decides if user needs an alert.
    Returns { status: "ok" | "alert", message?: str }.
    """
    try:
        return await assistant_heartbeat(
            context=body.context,
            model_id=body.model_id,
        )
    except Exception as e:
        logger.exception("assistant heartbeat failed: %s", e)
        return {"status": "ok"}  # Fail open


@app.get("/api/assistant/runs/{run_id}/events")
async def assistant_run_events(request: Request, run_id: str):
    """SSE proxy to executor run events (for approval_required, tool_result, etc.)."""
    try:
        uuid.UUID(run_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid run_id format")
    url = events_stream_url(run_id)
    async def event_gen():
        async with httpx.AsyncClient(timeout=30) as client:
            async with client.stream("GET", url) as resp:
                async for chunk in resp.aiter_bytes():
                    if await request.is_disconnected():
                        return
                    yield chunk
    from starlette.responses import StreamingResponse
    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


# ---------------------------------------------------------------------------
# Startup — init debate DB
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def _startup():
    try:
        init_db()
        logger.info("Debate DB initialized")
    except Exception as e:
        logger.warning("Debate DB init failed (debate features unavailable): %s", e)
    try:
        init_auth_db()
        logger.info("Auth DB initialized")
    except Exception as e:
        logger.warning("Auth DB init failed: %s", e)
    try:
        init_kb_db()
        logger.info("Knowledge Base DB initialized")
    except Exception as e:
        logger.warning("KB DB init failed (RAG features unavailable): %s", e)


# ---------------------------------------------------------------------------
# Debate Mode — Pydantic models
# ---------------------------------------------------------------------------

class PersonaConfig(BaseModel):
    gender: str = "neutral"
    profession: str = ""
    attitude: str = "logical"
    style: str = "formal"

class AgentProfileIn(BaseModel):
    agent_id: Literal["A", "B"]
    stance: Literal["FOR", "AGAINST"]
    persona: PersonaConfig = PersonaConfig()
    randomized: bool = False

class DebateConfig(BaseModel):
    turn_count: int = Field(default=5, ge=2, le=30)
    cross_exam_enabled: bool = True
    cross_exam_questions_per_agent: int = Field(default=1, ge=1, le=5)
    max_tokens_per_message: int = Field(default=300, ge=100, le=2000)
    max_sentences_per_message: int = Field(default=6, ge=2, le=50)
    no_repetition: bool = True
    retrieval_enabled: bool = False
    evidence_urls: list[str] = Field(default_factory=list, max_length=20)

class StartDebateRequest(BaseModel):
    topic: str = Field(min_length=2, max_length=500)
    perspective_dial: int = Field(default=50, ge=0, le=100)
    model_id: str = "openai"
    model_name: Optional[str] = None
    agent_a: AgentProfileIn
    agent_b: AgentProfileIn
    config: DebateConfig = DebateConfig()

    @field_validator("model_id")
    @classmethod
    def validate_debate_model(cls, v: str) -> str:
        if v not in VALID_MODELS:
            raise ValueError(f"Invalid model. Must be one of: {', '.join(VALID_MODELS)}")
        return v


# ---------------------------------------------------------------------------
# Debate Mode — active sessions (for cancellation)
# ---------------------------------------------------------------------------

_active_debates: dict[str, DebateOrchestrator] = {}


# ---------------------------------------------------------------------------
# Debate Mode — Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/debate/start")
async def start_debate(body: StartDebateRequest, request: Request):
    """Start a new debate session, streaming SSE events."""
    session_id = new_session_id()

    active_llm = _get_llm(body.model_id, body.model_name)

    create_session(
        session_id=session_id,
        topic=body.topic,
        perspective_dial=body.perspective_dial,
        provider_config={"model_id": body.model_id, "model_name": body.model_name},
        config=body.config.model_dump(),
        agents=[
            {"agent_id": "A", "stance": body.agent_a.stance,
             "persona": body.agent_a.persona.model_dump(), "randomized": body.agent_a.randomized},
            {"agent_id": "B", "stance": body.agent_b.stance,
             "persona": body.agent_b.persona.model_dump(), "randomized": body.agent_b.randomized},
        ],
    )

    orchestrator = DebateOrchestrator(
        session_id=session_id,
        topic=body.topic,
        agent_a={"agent_id": "A", "stance": body.agent_a.stance, "persona": body.agent_a.persona.model_dump()},
        agent_b={"agent_id": "B", "stance": body.agent_b.stance, "persona": body.agent_b.persona.model_dump()},
        config=body.config.model_dump(),
        perspective_dial=body.perspective_dial,
        llm=active_llm,
        evidence_urls=body.config.evidence_urls,
    )
    _active_debates[session_id] = orchestrator

    logger.info("Debate started [session=%s, topic=%s]", session_id, body.topic[:60])

    async def event_generator():
        try:
            async for event in orchestrator.run():
                if await request.is_disconnected():
                    orchestrator.cancel()
                    break
                yield {"event": event["event"], "data": json.dumps(event["data"])}
        except Exception as e:
            err_msg = _sanitize_error(str(e))
            yield {"event": "debate.error", "data": json.dumps({"sessionId": session_id, "error": err_msg})}
        finally:
            _active_debates.pop(session_id, None)

    return EventSourceResponse(event_generator())


@app.post("/api/debate/{session_id}/cancel")
async def cancel_debate(session_id: str):
    orchestrator = _active_debates.get(session_id)
    if orchestrator:
        orchestrator.cancel()
        return {"status": "cancelled", "sessionId": session_id}
    return JSONResponse(status_code=404, content={"error": "Session not found or already finished"})


@app.get("/api/debate/{session_id}")
async def get_debate(session_id: str):
    """Retrieve a completed debate session with all data."""
    data = get_session(session_id)
    if not data:
        raise HTTPException(404, "Session not found")
    return data


@app.get("/api/debate/{session_id}/export/{fmt}")
async def export_debate(session_id: str, fmt: str):
    """Export debate as markdown or JSON."""
    data = get_session(session_id)
    if not data:
        raise HTTPException(404, "Session not found")

    if fmt == "json":
        return JSONResponse(content=data)

    if fmt == "markdown" or fmt == "md":
        session = data["session"]
        agents = data["agents"]
        messages = data["messages"]
        artifacts = data.get("artifacts") or {}

        md = f"# Debate: {session['topic']}\n\n"
        md += f"**Created**: {session['created_at']}  \n"
        md += f"**Perspective Dial**: {session['perspective_dial']}  \n"
        md += f"**Status**: {session['status']}  \n\n"

        md += "## Personas\n\n"
        for a in agents:
            persona = json.loads(a["persona"]) if isinstance(a["persona"], str) else a["persona"]
            md += f"### Agent {a['agent_id']} ({a['stance']})\n"
            md += f"- Profession: {persona.get('profession', 'N/A')}\n"
            md += f"- Attitude: {persona.get('attitude', 'N/A')}\n"
            md += f"- Style: {persona.get('style', 'N/A')}\n\n"

        md += "## Transcript\n\n"
        for m in messages:
            phase_labels = {"debate": "", "cross_exam_question": " [Cross-Exam Q]", "cross_exam_answer": " [Cross-Exam A]"}
            reply = f" (replying to {m['reply_to_message_id']})" if m.get("reply_to_message_id") else ""
            md += f"### [{m['message_id']}] Agent {m['agent_id']}{phase_labels.get(m['phase'], '')}{reply}\n"
            md += f"{m['text']}\n\n"

        for key, title in [("summary", "Summary"), ("judge", "Judge Verdict"), ("coverage_gaps", "Coverage Gaps")]:
            raw = artifacts.get(key)
            if raw:
                parsed = json.loads(raw) if isinstance(raw, str) else raw
                md += f"## {title}\n\n```json\n{json.dumps(parsed, indent=2)}\n```\n\n"

        return JSONResponse(content={"format": "markdown", "content": md})

    raise HTTPException(400, f"Unknown export format: {fmt}. Use 'json' or 'markdown'.")


# ---------------------------------------------------------------------------
# Evidence Collection Endpoints
# ---------------------------------------------------------------------------

_browser_manager = BrowserSessionManager()


class EvidenceCollectRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    urls: list[str] = Field(default_factory=list, max_length=20)
    perspective: str = Field(default="neutral", pattern=r"^(FOR|AGAINST|neutral)$")
    max_urls: int = Field(default=8, ge=1, le=20)
    max_cards_per_url: int = Field(default=5, ge=1, le=10)
    model_id: str = os.getenv("DEFAULT_MODEL_PROVIDER", "openai")
    model_name: Optional[str] = None

    @field_validator("model_id")
    @classmethod
    def validate_evidence_model(cls, v: str) -> str:
        if v not in VALID_MODELS:
            raise ValueError(f"Invalid model. Must be one of: {', '.join(VALID_MODELS)}")
        return v


@app.post("/api/evidence/collect")
async def collect_evidence(body: EvidenceCollectRequest, request: Request):
    """
    Collect evidence cards from provided URLs.
    Returns EvidenceCardList with structured evidence.
    Optionally streams progress via SSE if Accept header includes text/event-stream.
    """
    client_ip = _get_client_ip(request)
    if not _rate_limiter.is_allowed(client_ip):
        raise HTTPException(429, "Rate limit exceeded.")

    active_llm = _get_llm(body.model_id, body.model_name)

    accept = request.headers.get("accept", "")
    if "text/event-stream" in accept:
        async def _sse_generator():
            async def _progress(event_type: str, data: dict):
                pass  # SSE events are yielded below

            try:
                result = await collect_web_evidence(
                    query=body.query,
                    urls=body.urls,
                    llm=active_llm,
                    perspective=body.perspective,
                    max_urls=body.max_urls,
                    max_cards_per_url=body.max_cards_per_url,
                )
                yield {
                    "event": "evidence.result",
                    "data": json.dumps(result.model_dump()),
                }
            except Exception as e:
                yield {
                    "event": "evidence.error",
                    "data": json.dumps({"error": str(e)}),
                }

        return EventSourceResponse(_sse_generator())

    result = await collect_web_evidence(
        query=body.query,
        urls=body.urls,
        llm=active_llm,
        perspective=body.perspective,
        max_urls=body.max_urls,
        max_cards_per_url=body.max_cards_per_url,
    )
    return result.model_dump()


# ---------------------------------------------------------------------------
# Knowledge Base — Management Endpoints
# ---------------------------------------------------------------------------

from fastapi import UploadFile, File, Form
from typing import List


@app.post("/api/kb/create")
async def kb_create(body: KBCreateRequest):
    kb = create_kb(body.name, body.description)
    return KBResponse(
        id=kb["id"],
        name=kb["name"],
        description=kb["description"],
        created_at=kb["created_at"],
        doc_count=0,
    )


@app.get("/api/kb/list")
async def kb_list():
    kbs = list_kbs()
    return [
        KBResponse(
            id=kb["id"],
            name=kb["name"],
            description=kb["description"],
            created_at=kb["created_at"],
            doc_count=kb.get("doc_count", 0),
        )
        for kb in kbs
    ]


@app.get("/api/kb/{kb_id}/docs")
async def kb_docs(kb_id: str):
    kb = get_kb(kb_id)
    if not kb:
        raise HTTPException(404, "Knowledge base not found")
    docs = list_docs(kb_id)
    return [
        DocumentResponse(
            id=d["id"],
            kb_id=d["kb_id"],
            filename=d["filename"],
            mime_type=d["mime_type"],
            file_ext=d["file_ext"],
            size_bytes=d["size_bytes"],
            content_hash_sha256=d["content_hash_sha256"],
            source_type=d["source_type"],
            relative_path=d["relative_path"],
            status=d["status"],
            error_message=d.get("error_message"),
            created_at=d["created_at"],
            updated_at=d["updated_at"],
            chunk_count=d.get("chunk_count", 0),
        )
        for d in docs
    ]


@app.delete("/api/kb/{kb_id}")
async def kb_delete(kb_id: str):
    if delete_kb(kb_id):
        return {"status": "deleted", "kb_id": kb_id}
    raise HTTPException(404, "Knowledge base not found")


@app.delete("/api/kb/{kb_id}/doc/{doc_id}")
async def kb_doc_delete(kb_id: str, doc_id: str):
    if delete_document(doc_id):
        return {"status": "deleted", "doc_id": doc_id}
    raise HTTPException(404, "Document not found")


# ---------------------------------------------------------------------------
# Knowledge Base — Upload / Import Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/kb/{kb_id}/upload")
async def kb_upload(
    kb_id: str,
    files: List[UploadFile] = File(...),
    force_reindex: bool = Form(default=False),
):
    """Upload one or more files to a knowledge base."""
    kb = get_kb(kb_id)
    if not kb:
        raise HTTPException(404, "Knowledge base not found")

    results: list[dict] = []
    for f in files:
        file_bytes = await f.read()
        r = ingest_single_file(
            kb_id=kb_id,
            filename=f.filename or "unknown",
            file_bytes=file_bytes,
            source_type="upload",
            force_reindex=force_reindex,
        )
        results.append(r)

    indexed = sum(1 for r in results if r["status"] == "indexed")
    skipped = sum(1 for r in results if r["status"] == "skipped_cached")
    failed = sum(1 for r in results if r["status"] == "failed")

    return UploadResponse(
        kb_id=kb_id,
        results=[DocStatusItem(**r) for r in results],
        total_files=len(results),
        indexed=indexed,
        skipped_cached=skipped,
        failed=failed,
    )


@app.post("/api/kb/{kb_id}/upload-directory")
async def kb_upload_directory(
    kb_id: str,
    files: List[UploadFile] = File(...),
    force_reindex: bool = Form(default=False),
):
    """Upload directory contents (via webkitdirectory)."""
    kb = get_kb(kb_id)
    if not kb:
        raise HTTPException(404, "Knowledge base not found")

    file_pairs: list[tuple[str, bytes]] = []
    for f in files:
        data = await f.read()
        file_pairs.append((f.filename or "unknown", data))

    results = ingest_files(
        kb_id=kb_id,
        files=file_pairs,
        source_type="folder",
        force_reindex=force_reindex,
    )

    indexed = sum(1 for r in results if r["status"] == "indexed")
    skipped = sum(1 for r in results if r["status"] == "skipped_cached")
    failed = sum(1 for r in results if r["status"] == "failed")

    return UploadResponse(
        kb_id=kb_id,
        results=[DocStatusItem(**r) for r in results],
        total_files=len(results),
        indexed=indexed,
        skipped_cached=skipped,
        failed=failed,
    )


@app.post("/api/kb/{kb_id}/upload-zip")
async def kb_upload_zip(
    kb_id: str,
    file: UploadFile = File(...),
    force_reindex: bool = Form(default=False),
):
    """Upload a zip file and ingest all supported files inside."""
    kb = get_kb(kb_id)
    if not kb:
        raise HTTPException(404, "Knowledge base not found")

    zip_bytes = await file.read()
    results = ingest_zip(
        kb_id=kb_id,
        zip_bytes=zip_bytes,
        force_reindex=force_reindex,
    )

    indexed = sum(1 for r in results if r["status"] == "indexed")
    skipped = sum(1 for r in results if r["status"] == "skipped_cached")
    failed = sum(1 for r in results if r["status"] == "failed")

    return UploadResponse(
        kb_id=kb_id,
        results=[DocStatusItem(**r) for r in results],
        total_files=len(results),
        indexed=indexed,
        skipped_cached=skipped,
        failed=failed,
    )


# ---------------------------------------------------------------------------
# RAG Query Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/rag/query")
async def rag_query(body: RAGQueryRequest):
    """Synchronous RAG query — returns full grounded response."""
    kb = get_kb(body.kb_id)
    if not kb:
        raise HTTPException(404, "Knowledge base not found")

    response = await query_rag(
        kb_id=body.kb_id,
        query=body.query,
        scope=body.scope,
        top_k_kb=body.top_k_kb,
        top_k_web=body.top_k_web,
        model_id=body.model_id,
        model_name=body.model_name,
    )
    return response.model_dump()


@app.post("/api/rag/query/stream")
async def rag_query_stream(request: Request, body: RAGQueryRequest):
    """SSE streaming RAG query."""
    kb = get_kb(body.kb_id)
    if not kb:
        raise HTTPException(404, "Knowledge base not found")

    async def event_generator():
        try:
            async for event in query_rag_stream(
                kb_id=body.kb_id,
                query=body.query,
                scope=body.scope,
                top_k_kb=body.top_k_kb,
                top_k_web=body.top_k_web,
                model_id=body.model_id,
                model_name=body.model_name,
            ):
                if await request.is_disconnected():
                    break
                yield {"event": event["event"], "data": json.dumps(event["data"])}
        except Exception as e:
            err_msg = _sanitize_error(str(e))
            yield {"event": "rag.error", "data": json.dumps({"error": err_msg})}

    return EventSourceResponse(event_generator())


# ---------------------------------------------------------------------------
# Shutdown hook — cleanup browser sessions
# ---------------------------------------------------------------------------

@app.on_event("shutdown")
async def _shutdown():
    await _browser_manager.close_all()
