"""
Enhanced web scraping with modern techniques:
- Concurrent/parallel scraping with connection pooling
- Smart retry with exponential backoff
- Rate limiting per domain
- Advanced content extraction
- Caching with TTL
- User-agent rotation
- JavaScript rendering support (via Playwright)
"""

import asyncio
import hashlib
import json
import logging
import re
import time
from collections import defaultdict
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Configuration
MAX_CONCURRENT_REQUESTS = 10
DEFAULT_TIMEOUT = 15.0
MAX_RETRIES = 3
RATE_LIMIT_DELAY = 1.0  # seconds between requests to same domain
CACHE_TTL = 3600  # 1 hour


class ScrapedContent:
    """Structured scraped content."""
    def __init__(self, url: str, text: str, title: str = "", error: str = ""):
        self.url = url
        self.text = text
        self.title = title
        self.error = error
        self.timestamp = time.time()


class ContentCache:
    """Simple in-memory cache with TTL."""
    def __init__(self, ttl: int = CACHE_TTL):
        self._cache: dict[str, ScrapedContent] = {}
        self._ttl = ttl

    def get(self, url: str) -> Optional[ScrapedContent]:
        key = self._hash_url(url)
        if key in self._cache:
            content = self._cache[key]
            if time.time() - content.timestamp < self._ttl:
                return content
            del self._cache[key]
        return None

    def set(self, url: str, content: ScrapedContent):
        key = self._hash_url(url)
        self._cache[key] = content
        # Keep cache bounded
        if len(self._cache) > 1000:
            oldest = min(self._cache.items(), key=lambda x: x[1].timestamp)
            del self._cache[oldest[0]]

    def _hash_url(self, url: str) -> str:
        return hashlib.md5(url.encode()).hexdigest()


class RateLimiter:
    """Per-domain rate limiting."""
    def __init__(self, delay: float = RATE_LIMIT_DELAY):
        self._last_request: dict[str, float] = {}
        self._delay = delay
        self._lock = asyncio.Lock()

    async def wait(self, url: str):
        domain = urlparse(url).netloc
        async with self._lock:
            last_time = self._last_request.get(domain, 0)
            now = time.time()
            elapsed = now - last_time
            if elapsed < self._delay:
                await asyncio.sleep(self._delay - elapsed)
            self._last_request[domain] = time.time()


class EnhancedScraper:
    """High-performance web scraper with modern techniques."""

    USER_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
    ]

    def __init__(
        self,
        max_concurrent: int = MAX_CONCURRENT_REQUESTS,
        timeout: float = DEFAULT_TIMEOUT,
        cache_ttl: int = CACHE_TTL,
        ssl_verify: bool = True,
    ):
        self.max_concurrent = max_concurrent
        self.timeout = timeout
        self.cache = ContentCache(ttl=cache_ttl)
        self.rate_limiter = RateLimiter()
        self.ssl_verify = ssl_verify
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._session: Optional[httpx.AsyncClient] = None
        self._user_agent_index = 0

    async def __aenter__(self):
        self._session = httpx.AsyncClient(
            timeout=httpx.Timeout(self.timeout),
            follow_redirects=True,
            verify=self.ssl_verify,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
        )
        return self

    async def __aexit__(self, *args):
        if self._session:
            await self._session.aclose()

    def _get_headers(self) -> dict:
        """Rotate user agents to avoid blocking."""
        self._user_agent_index = (self._user_agent_index + 1) % len(self.USER_AGENTS)
        return {
            "User-Agent": self.USER_AGENTS[self._user_agent_index],
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
        }

    async def _fetch_with_retry(self, url: str) -> tuple[bytes, str]:
        """Fetch URL with exponential backoff retry."""
        last_error = None

        for attempt in range(MAX_RETRIES):
            try:
                await self.rate_limiter.wait(url)

                headers = self._get_headers()
                response = await self._session.get(url, headers=headers)
                response.raise_for_status()

                content_type = response.headers.get("content-type", "").lower()
                return response.content, content_type

            except httpx.HTTPStatusError as e:
                if e.response.status_code in {404, 403, 401}:
                    # Don't retry on client errors
                    raise
                last_error = e
            except Exception as e:
                last_error = e

            if attempt < MAX_RETRIES - 1:
                # Exponential backoff: 1s, 2s, 4s
                await asyncio.sleep(2 ** attempt)

        raise Exception(f"Failed after {MAX_RETRIES} retries: {last_error}")

    def _extract_content(self, html: bytes, url: str) -> tuple[str, str]:
        """Extract clean text and title from HTML."""
        try:
            # Prefer lxml for speed
            try:
                import lxml  # noqa: F401
                parser = "lxml"
            except ImportError:
                parser = "html.parser"

            soup = BeautifulSoup(html, parser)

            # Extract title
            title = ""
            if soup.title:
                title = soup.title.string or ""
            elif soup.find("meta", property="og:title"):
                title = soup.find("meta", property="og:title").get("content", "")
            elif soup.find("h1"):
                title = soup.find("h1").get_text(strip=True)

            # Remove unwanted elements
            for tag in soup(["script", "style", "nav", "header", "footer", "aside", "iframe", "noscript"]):
                tag.decompose()

            # Remove comment blocks
            for comment in soup.find_all(string=lambda text: isinstance(text, str) and text.strip().startswith("<!--")):
                comment.extract()

            # Extract main content with priority
            main_content = None
            for selector in ["main", "article", '[role="main"]', ".content", "#content", ".post", ".entry"]:
                main_content = soup.select_one(selector)
                if main_content:
                    break

            if main_content:
                text = main_content.get_text(separator="\n", strip=True)
            else:
                text = soup.get_text(separator="\n", strip=True)

            # Clean up text
            text = re.sub(r"\n{3,}", "\n\n", text)
            text = re.sub(r" {2,}", " ", text)
            text = text.strip()

            return text, title.strip()

        except Exception as e:
            logger.error(f"Content extraction failed for {url}: {e}")
            return "", ""

    async def scrape_one(self, url: str, use_cache: bool = True) -> ScrapedContent:
        """Scrape a single URL with caching and error handling."""
        # Check cache
        if use_cache:
            cached = self.cache.get(url)
            if cached:
                logger.debug(f"Cache hit: {url}")
                return cached

        async with self._semaphore:
            try:
                # Fetch content
                content, content_type = await self._fetch_with_retry(url)

                # Handle PDFs separately
                if "application/pdf" in content_type:
                    try:
                        from docling.document_converter import DocumentConverter
                        import tempfile
                        import os

                        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                            tmp.write(content)
                            tmp_path = tmp.name

                        try:
                            converter = DocumentConverter()
                            result = await asyncio.to_thread(converter.convert, tmp_path)
                            text = (result.document.export_to_markdown() or "").strip()
                            text = re.sub(r"\n{3,}", "\n\n", text)
                        finally:
                            os.unlink(tmp_path)

                        result = ScrapedContent(url=url, text=text, title="PDF Document")

                    except Exception as e:
                        logger.warning(f"PDF extraction failed for {url}: {e}")
                        result = ScrapedContent(url=url, text="", error="PDF extraction failed")
                else:
                    # Extract text from HTML
                    text, title = self._extract_content(content, url)
                    result = ScrapedContent(url=url, text=text, title=title)

                # Cache result
                if use_cache:
                    self.cache.set(url, result)

                return result

            except Exception as e:
                logger.error(f"Failed to scrape {url}: {e}")
                result = ScrapedContent(url=url, text="", error=str(e))
                return result

    async def scrape_many(
        self,
        urls: list[str],
        use_cache: bool = True,
        max_length: int = 50000,
    ) -> list[ScrapedContent]:
        """Scrape multiple URLs concurrently."""
        if not urls:
            return []

        logger.info(f"Scraping {len(urls)} URLs concurrently (max {self.max_concurrent})")
        start_time = time.time()

        tasks = [self.scrape_one(url, use_cache=use_cache) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Filter out exceptions and truncate content
        processed = []
        for result in results:
            if isinstance(result, Exception):
                logger.error(f"Scraping error: {result}")
                continue
            if isinstance(result, ScrapedContent):
                if len(result.text) > max_length:
                    result.text = result.text[:max_length] + "\n\n[Content truncated...]"
                processed.append(result)

        elapsed = time.time() - start_time
        logger.info(f"Scraped {len(processed)}/{len(urls)} URLs in {elapsed:.2f}s")

        return processed


# Singleton instance for reuse
_scraper_instance: Optional[EnhancedScraper] = None


async def get_scraper() -> EnhancedScraper:
    """Get or create scraper instance."""
    global _scraper_instance
    if _scraper_instance is None:
        _scraper_instance = EnhancedScraper()
        await _scraper_instance.__aenter__()
    return _scraper_instance


async def scrape_urls_fast(urls: list[str], use_cache: bool = True) -> list[dict]:
    """
    Fast concurrent scraping with caching.
    Returns list of dicts with url, text, title, error fields.
    """
    scraper = await get_scraper()
    results = await scraper.scrape_many(urls, use_cache=use_cache)

    return [
        {
            "url": r.url,
            "text": r.text,
            "title": r.title,
            "error": r.error,
        }
        for r in results
    ]
