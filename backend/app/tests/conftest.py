"""
Shared pytest fixtures for backend tests.
"""

import os
import pytest

os.environ.setdefault("OPENAI_API_KEY", "test-key-not-real")
os.environ.setdefault("SERPAPI_API_KEY", "test-key-not-real")
os.environ.setdefault("SEARCH_PROVIDER", "serpapi")
os.environ.setdefault("SSL_VERIFY", "false")
os.environ.setdefault("SEMANTIC_CACHE_DB", "/tmp/test_semantic_cache.db")
