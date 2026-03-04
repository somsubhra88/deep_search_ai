# syntax=docker/dockerfile:1
FROM python:3.12-slim AS builder

WORKDIR /app

COPY requirements.txt .
# Cache pip layer for faster rebuilds
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g @anthropic-ai/agent-browser 2>/dev/null || true && \
    apt-get purge -y curl && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY backend/ .

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser && \
    mkdir -p /app/data /app/chroma_data /tmp/agent_browser && \
    chown -R appuser:appgroup /app /tmp/agent_browser

USER appuser

ENV PYTHONUNBUFFERED=1
ENV AGENT_BROWSER_WORKDIR=/tmp/agent_browser
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s \
  CMD python -c "import httpx; httpx.get('http://localhost:8000/health').raise_for_status()" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
