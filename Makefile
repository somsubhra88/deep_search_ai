.PHONY: setup start stop restart logs clean dev-backend dev-frontend dist help

# Default target
help: ## Show this help
	@echo ""
	@echo "  Deep Search AI Agent"
	@echo "  ===================="
	@echo ""
	@echo "  Quick start:"
	@echo "    make setup   → copy .env.example, then add your API keys"
	@echo "    make start   → build & run with Docker Compose"
	@echo "    make stop    → stop all containers"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""

setup: ## Create .env from template (won't overwrite existing)
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "✅ Created .env from .env.example"; \
		echo "👉 Open .env and add your API keys before running 'make start'"; \
	else \
		echo "⚠️  .env already exists — skipping (edit manually if needed)"; \
	fi

start: ## Build and start all services (Docker)
	@if [ ! -f .env ]; then \
		echo "❌ No .env file found. Run 'make setup' first."; \
		exit 1; \
	fi
	DOCKER_BUILDKIT=1 docker compose up --build -d
	@echo ""
	@echo "✅ Deep Search AI is running!"
	@echo "   Frontend: http://localhost:$${FRONTEND_PORT:-3000}"
	@echo "   Backend:  http://localhost:$${BACKEND_PORT:-8000}/health"
	@echo ""
	@echo "   Run 'make logs' to see live output"
	@echo "   Run 'make stop' to shut down"

stop: ## Stop all services
	docker compose down
	@echo "✅ Stopped"

restart: ## Restart all services
	docker compose down
	DOCKER_BUILDKIT=1 docker compose up --build -d
	@echo "✅ Restarted"

logs: ## Follow live logs from all services
	docker compose logs -f

logs-backend: ## Follow backend logs only
	docker compose logs -f backend

logs-frontend: ## Follow frontend logs only
	docker compose logs -f frontend

status: ## Show running containers and health
	docker compose ps

clean: ## Remove containers, images, and volumes
	docker compose down --rmi local --volumes --remove-orphans
	@echo "✅ Cleaned up Docker resources"

dist: ## Build clean distributable package under ./dist
	./build_dist.sh

dev-backend: ## Run backend locally (no Docker)
	cd backend && uv run --project .. uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend: ## Run frontend locally (no Docker)
	cd frontend && npm run dev
