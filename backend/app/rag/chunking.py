"""
Text chunking with boilerplate removal and hard caps.

Produces overlapping chunks suitable for embedding and retrieval.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

DEFAULT_CHUNK_SIZE = 600
DEFAULT_OVERLAP = 80
MAX_CHUNK_SIZE = 1200
MIN_CHUNK_SIZE = 40

_BOILERPLATE_PATTERNS = [
    re.compile(r"(?i)cookie\s+(policy|consent|preferences|notice)"),
    re.compile(r"(?i)accept\s+all\s+cookies"),
    re.compile(r"(?i)privacy\s+policy"),
    re.compile(r"(?i)terms\s+(of\s+)?(service|use)"),
    re.compile(r"(?i)subscribe\s+to\s+(our\s+)?newsletter"),
    re.compile(r"(?i)sign\s+up\s+for\s+free"),
    re.compile(r"(?i)©\s*\d{4}"),
    re.compile(r"(?i)all\s+rights\s+reserved"),
    re.compile(r"(?i)powered\s+by\s+\w+"),
    re.compile(r"(?i)share\s+(this|on)\s+(facebook|twitter|linkedin)"),
    re.compile(r"(?i)advertisement"),
    re.compile(r"(?i)skip\s+to\s+(main\s+)?content"),
]


@dataclass
class TextChunk:
    text: str
    index: int
    start_char: int
    end_char: int
    source_url: str = ""
    metadata: dict = field(default_factory=dict)


def _remove_boilerplate(text: str) -> str:
    """Remove common web boilerplate lines."""
    lines = text.split("\n")
    cleaned: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if cleaned and cleaned[-1] != "":
                cleaned.append("")
            continue
        if len(stripped) < 10:
            continue
        if any(pat.search(stripped) for pat in _BOILERPLATE_PATTERNS):
            continue
        cleaned.append(stripped)
    return "\n".join(cleaned).strip()


def _normalize_whitespace(text: str) -> str:
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def chunk_text(
    text: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_OVERLAP,
    source_url: str = "",
    remove_boilerplate: bool = True,
) -> list[TextChunk]:
    """
    Split text into overlapping chunks with hard caps.

    Tries to break at sentence boundaries when possible.
    """
    if not text or not text.strip():
        return []

    chunk_size = min(chunk_size, MAX_CHUNK_SIZE)
    overlap = min(overlap, chunk_size // 2)

    if remove_boilerplate:
        text = _remove_boilerplate(text)
    text = _normalize_whitespace(text)

    if not text:
        return []

    if len(text) <= chunk_size:
        return [TextChunk(
            text=text, index=0, start_char=0, end_char=len(text),
            source_url=source_url,
        )]

    chunks: list[TextChunk] = []
    pos = 0
    idx = 0

    while pos < len(text):
        end = min(pos + chunk_size, len(text))
        segment = text[pos:end]

        if end < len(text):
            for sep in [". ", ".\n", "! ", "? ", "\n\n", "\n", "; ", ", "]:
                last = segment.rfind(sep)
                if last > chunk_size * 0.4:
                    end = pos + last + len(sep)
                    segment = text[pos:end]
                    break

        segment = segment.strip()
        if len(segment) >= MIN_CHUNK_SIZE:
            chunks.append(TextChunk(
                text=segment, index=idx, start_char=pos, end_char=end,
                source_url=source_url,
            ))
            idx += 1

        next_pos = end - overlap
        if next_pos <= pos:
            next_pos = end
        pos = next_pos

    return chunks
