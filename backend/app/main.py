"""
Deep Search AI Agent - FastAPI Backend
Streams research progress via Server-Sent Events (SSE).
Includes rate limiting, input validation, security headers, and error sanitization.
"""

import json
import logging
import os
import time
from collections import defaultdict

from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from starlette.middleware.base import BaseHTTPMiddleware
from sse_starlette.sse import EventSourceResponse

import pathlib

load_dotenv(dotenv_path=pathlib.Path(__file__).resolve().parents[2] / ".env")

from app.agent import run_research_agent
from app.memory_graph import recall_past_context

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://frontend:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


# ---------------------------------------------------------------------------
# Request Validation
# ---------------------------------------------------------------------------

VALID_MODES = {"standard", "debate", "timeline", "academic", "fact_check", "deep_dive"}
VALID_MODELS = {"openai", "qwen"}
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
    model_id: str = "openai"

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
    import re
    for pattern, replacement in sensitive_patterns:
        error = re.sub(pattern, replacement, error)
    return error


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.2.0"}


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

    logger.info("Research request from %s [%s|%s]: %s", client_ip, model_id, "+".join(modes), query[:80])

    recalled_memories: list[dict] = []
    try:
        recalled_memories = await recall_past_context(query)
        if recalled_memories:
            logger.info("Recalled %d past memories for: %s", len(recalled_memories), query[:50])
    except Exception as e:
        logger.warning("Memory recall failed (non-fatal): %s", e)

    async def event_generator():
        try:
            async for event in run_research_agent(
                query,
                use_snippets_only=use_snippets_only,
                safe_search=safe_search,
                modes=modes,
                model_id=model_id,
                recalled_memories=recalled_memories,
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


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )
