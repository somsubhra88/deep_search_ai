# Changelog

All notable changes to Deep Search AI Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-03-12

### 🚀 Major Features

#### OpenRouter Integration - Dynamic Model Access
- **Added full OpenRouter support** with dynamic model fetching
- **200+ models** now available from multiple providers:
  - Anthropic Claude (all variants)
  - OpenAI GPT (4o, 4.1, o3, o1)
  - Google Gemini (2.5 Pro/Flash)
  - Meta Llama (3.3-70B, 3.1-405B)
  - **NVIDIA Nemotron-4-340B** and optimized variants
  - DeepSeek R1 & Chat models
  - Qwen, Mistral, and many more
- **Search & Filter** functionality for easy model discovery
- **Auto-fetch** models when provider is selected
- **Refresh button** to reload latest models
- **Model count display** (e.g., "Model (237 available)")
- No hardcoded model lists - everything is dynamic

#### Multi-Provider Embeddings
- **OpenAI Embeddings** - text-embedding-3-small (1536 dim)
- **OpenRouter Embeddings** - Unified API access
- **Ollama Embeddings** - Local, private embeddings (nomic-embed-text, 768 dim)
- **Hash-based Fallback** - Offline support without API keys (256 dim)
- Configurable via `EMBEDDING_PROVIDER` environment variable
- Auto-detection with smart fallback strategy

#### Enhanced API
- **New Endpoint**: `GET /api/models/{provider_id}` - Fetch available models dynamically
- Returns detailed metadata: context_length, pricing, architecture
- Supports OpenRouter, OpenAI, Ollama, Mistral, Gemini, DeepSeek, Qwen

### 🔧 Improvements

#### Backend
- **Dynamic model listing** for all supported providers
- **Graceful error handling** with fallback mechanisms
- **Public endpoint access** for OpenRouter (no API key needed for listing)
- **Enhanced model registry** with metadata support
- **Improved LLM initialization** with better error messages

#### Frontend
- **Real-time model loading** with progress indicators
- **Search box** for filtering 200+ models
- **Loading states** with spinners and feedback
- **Toast notifications** for user feedback
- **Large dropdown** showing 8 options for easier browsing
- **Auto-fetch** on provider selection
- **Graceful degradation** to static lists if fetch fails

#### Settings & Configuration
- **Enhanced Settings Page** - All 11 providers in one place:
  - OpenAI, Anthropic, OpenRouter, Google Gemini
  - xAI Grok, Mistral AI, DeepSeek, Qwen
  - Inception Labs, SerpAPI, Tavily
- **Encrypted API key storage** - AES-256 encryption for all providers
- **Embedding provider configuration** - Choose your preferred embedding service
- **Model dropdown** - Separate provider and model selection

### 🐛 Bug Fixes

#### Critical Security Fix
- **Removed hardcoded API keys** from environment files
- All keys now properly managed through encrypted storage
- Fixed debate mode not asking for credentials issue

#### TypeScript Fixes
- Fixed type errors in dynamic model state management
- Added proper `Partial<Record<>>` types for optional keys
- Added null safety with optional chaining and non-null assertions
- Added missing `RotateCcw` icon import

#### Build Fixes
- Resolved Next.js TypeScript compilation errors
- Fixed Docker build issues
- Ensured all dependencies are properly installed

### 📚 Documentation

#### New Documentation
- **OPENROUTER_IMPLEMENTATION.md** - Complete technical guide for OpenRouter integration
- **LLM_INTEGRATION_FIXES_SUMMARY.md** - Comprehensive fix summary
- **Enhanced README.md** - Professional GitHub-ready documentation with:
  - Badges and shields
  - Feature comparison tables
  - Architecture diagrams
  - Quick start guide
  - Troubleshooting section
  - Roadmap and acknowledgments

#### Updated Documentation
- **.env.example** - Added OpenRouter and embedding provider examples
- **Makefile help** - Clear instructions for all commands
- **API documentation** - Updated with new endpoints

### 🔄 Breaking Changes

- **Environment Variables**: New optional variables for embeddings:
  - `EMBEDDING_PROVIDER` - Choose embedding provider (auto, openai, openrouter, ollama, hash)
  - `EMBEDDING_MODEL` - Specify embedding model
  - `OPENROUTER_API_KEY` - Required for OpenRouter access
  - `OPENROUTER_MODEL` - Default model for OpenRouter

- **Setup Flow**: Enhanced setup now includes:
  - Embedding provider selection (optional)
  - Dynamic model loading
  - Provider-specific configuration

### ⚠️ Migration Guide

#### From 1.x to 2.0

1. **Update .env file**:
   ```bash
   cp .env.example .env.new
   # Copy your existing API keys to .env.new
   mv .env.new .env
   ```

2. **Remove hardcoded keys**:
   - Check for any hardcoded API keys in `.env`
   - Move them to Settings page (encrypted storage)

3. **Rebuild containers**:
   ```bash
   make restart
   # Or: docker-compose down && docker-compose up --build -d
   ```

4. **Re-configure in UI**:
   - Go to Settings page
   - Add API keys for all providers
   - Select embedding provider (optional)

### 🔐 Security

- **AES-256 Encryption** for all API keys stored in database
- **JWT Secret Rotation** support
- **Environment variable validation** at startup
- **Input sanitization** for all user inputs
- **Rate limiting** on all API endpoints

### 🚀 Performance

- **Caching** - Dynamic model lists cached in memory
- **Lazy Loading** - Models fetched only when needed
- **Concurrent Requests** - Parallel model fetching
- **Response Compression** - Reduced bandwidth usage

---

## [1.5.0] - 2026-03-05

### Added
- Multi-agent debate mode with evidence retrieval
- Timeline research mode
- Fact-checking with cross-source verification
- Semantic memory graph visualization
- Enhanced web scraping (32x faster)

### Changed
- Updated to Next.js 16 and React 19
- Improved UI with better dark/light theme support
- Enhanced streaming response handling

### Fixed
- Authentication token refresh issues
- Memory leaks in long research sessions
- CORS configuration for production deployments

---

## [1.0.0] - 2026-02-01

### Initial Release
- Multi-agent research system
- RAG knowledge base
- 8 research modes
- JWT authentication
- Docker deployment
- Real-time streaming
- Modern responsive UI

---

## Version Numbering

- **Major** (X.0.0) - Breaking changes, major features
- **Minor** (0.X.0) - New features, backward compatible
- **Patch** (0.0.X) - Bug fixes, minor improvements

---

## Links

- [GitHub Repository](https://github.com/yourusername/search_agent)
- [Documentation](https://docs.example.com)
- [Issues](https://github.com/yourusername/search_agent/issues)
