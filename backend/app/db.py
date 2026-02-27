"""
Debate session persistence — SQLite with WAL mode.
"""

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pathlib

def _resolve_db_path() -> pathlib.Path:
    """Find a writable location for the debate DB."""
    base = pathlib.Path(__file__).resolve()
    candidates = [
        base.parents[2] / "data" / "debate.db",   # local repo: search_agent/data/debate.db
        base.parents[1] / "data" / "debate.db",    # docker: /app/data/debate.db
    ]
    for p in candidates:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            return p
        except PermissionError:
            continue
    return candidates[-1]

DB_PATH = _resolve_db_path()


def _get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    conn = _get_connection()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS debate_session (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        topic TEXT NOT NULL,
        perspective_dial INTEGER NOT NULL DEFAULT 50,
        provider_config TEXT,
        config TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle'
            CHECK(status IN ('idle','running','cancelled','completed','error'))
    );

    CREATE TABLE IF NOT EXISTS agent_profile (
        session_id TEXT NOT NULL REFERENCES debate_session(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL CHECK(agent_id IN ('A','B')),
        stance TEXT NOT NULL CHECK(stance IN ('FOR','AGAINST')),
        persona TEXT NOT NULL,
        randomized INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS message (
        session_id TEXT NOT NULL REFERENCES debate_session(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK(phase IN
            ('debate','cross_exam_question','cross_exam_answer','system')),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reply_to_message_id TEXT,
        challenges_message_id TEXT,
        answers_question_id TEXT,
        PRIMARY KEY (session_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS artifact (
        session_id TEXT PRIMARY KEY REFERENCES debate_session(id) ON DELETE CASCADE,
        summary TEXT,
        judge TEXT,
        argument_graph TEXT,
        coverage_gaps TEXT,
        exports_meta TEXT
    );
    """)
    conn.commit()
    conn.close()


def new_session_id() -> str:
    return uuid.uuid4().hex[:16]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_session(
    session_id: str,
    topic: str,
    perspective_dial: int,
    provider_config: dict,
    config: dict,
    agents: list[dict],
) -> None:
    conn = _get_connection()
    now = _now()
    conn.execute(
        "INSERT INTO debate_session (id, created_at, updated_at, topic, perspective_dial, provider_config, config, status) VALUES (?,?,?,?,?,?,?,?)",
        (session_id, now, now, topic, perspective_dial,
         json.dumps(provider_config), json.dumps(config), "running"),
    )
    for agent in agents:
        conn.execute(
            "INSERT INTO agent_profile (session_id, agent_id, stance, persona, randomized) VALUES (?,?,?,?,?)",
            (session_id, agent["agent_id"], agent["stance"],
             json.dumps(agent["persona"]), int(agent.get("randomized", False))),
        )
    conn.execute("INSERT INTO artifact (session_id) VALUES (?)", (session_id,))
    conn.commit()
    conn.close()


def update_session_status(session_id: str, status: str) -> None:
    conn = _get_connection()
    conn.execute(
        "UPDATE debate_session SET status=?, updated_at=? WHERE id=?",
        (status, _now(), session_id),
    )
    conn.commit()
    conn.close()


def insert_message(msg: dict) -> None:
    conn = _get_connection()
    conn.execute(
        "INSERT INTO message (session_id, message_id, agent_id, phase, text, created_at, reply_to_message_id, challenges_message_id, answers_question_id) VALUES (?,?,?,?,?,?,?,?,?)",
        (
            msg["session_id"], msg["message_id"], msg["agent_id"],
            msg["phase"], msg["text"], msg["created_at"],
            msg.get("reply_to_message_id"),
            msg.get("challenges_message_id"),
            msg.get("answers_question_id"),
        ),
    )
    conn.commit()
    conn.close()


def update_artifacts(session_id: str, **kwargs: Any) -> None:
    conn = _get_connection()
    set_parts = []
    values = []
    for key in ("summary", "judge", "argument_graph", "coverage_gaps", "exports_meta"):
        if key in kwargs:
            set_parts.append(f"{key}=?")
            val = kwargs[key]
            values.append(json.dumps(val) if not isinstance(val, str) else val)
    if set_parts:
        values.append(session_id)
        conn.execute(
            f"UPDATE artifact SET {', '.join(set_parts)} WHERE session_id=?",
            tuple(values),
        )
        conn.commit()
    conn.close()


def get_session(session_id: str) -> dict | None:
    conn = _get_connection()
    row = conn.execute("SELECT * FROM debate_session WHERE id=?", (session_id,)).fetchone()
    if not row:
        conn.close()
        return None
    session = dict(row)
    agents = [dict(r) for r in conn.execute("SELECT * FROM agent_profile WHERE session_id=?", (session_id,)).fetchall()]
    messages = [dict(r) for r in conn.execute("SELECT * FROM message WHERE session_id=? ORDER BY created_at", (session_id,)).fetchall()]
    artifact = conn.execute("SELECT * FROM artifact WHERE session_id=?", (session_id,)).fetchone()
    conn.close()
    return {
        "session": session,
        "agents": agents,
        "messages": messages,
        "artifacts": dict(artifact) if artifact else None,
    }
