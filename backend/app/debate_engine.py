"""
Debate orchestration engine — deterministic state machine.

Phases:
  0. Evidence retrieval (optional — when retrieval_enabled=True)
  1. Main debate (alternating turns A/B)
  2. Cross-examination (A asks→B answers, B asks→A answers, repeat)
  3. Artifact generation (summary, judge, argument graph, coverage gaps)
"""

import asyncio
import json
import logging
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import AsyncGenerator, Optional

from app.db import insert_message, update_artifacts, update_session_status
from app.schemas.evidence import EvidenceCard, EvidenceConfig, get_evidence_config

logger = logging.getLogger(__name__)


class DebateOrchestrator:
    """Runs a full debate session, yielding SSE events."""

    def __init__(
        self,
        session_id: str,
        topic: str,
        agent_a: dict,
        agent_b: dict,
        config: dict,
        perspective_dial: int,
        llm,
        evidence_urls: Optional[list[str]] = None,
    ):
        self.session_id = session_id
        self.topic = topic
        self.agents = {"A": agent_a, "B": agent_b}
        self.config = config
        self.perspective_dial = perspective_dial
        self.llm = llm
        self.messages: list[dict] = []
        self.turn_counter = {"A": 0, "B": 0}
        self._cancelled = False

        self.evidence_cards: dict[str, list[EvidenceCard]] = {"A": [], "B": []}
        self._evidence_urls = evidence_urls or []
        self._evidence_config = get_evidence_config("debate")

    def cancel(self) -> None:
        self._cancelled = True

    async def run(self) -> AsyncGenerator[dict, None]:
        """Yield SSE-shaped dicts for the entire debate lifecycle."""
        yield _evt("debate.started", {"sessionId": self.session_id})

        try:
            if self.config.get("retrieval_enabled", False) and self._evidence_urls:
                async for ev in self._run_evidence_retrieval():
                    yield ev
                    if self._cancelled:
                        break

            if not self._cancelled:
                async for ev in self._run_main_debate():
                    yield ev
                    if self._cancelled:
                        break

            if not self._cancelled and self.config.get("cross_exam_enabled", True):
                async for ev in self._run_cross_exam():
                    yield ev
                    if self._cancelled:
                        break

            if not self._cancelled:
                async for ev in self._generate_artifacts():
                    yield ev

            status = "cancelled" if self._cancelled else "completed"
        except Exception as exc:
            logger.exception("Debate engine error: %s", exc)
            yield _evt("debate.error", {"sessionId": self.session_id, "error": str(exc)})
            status = "error"

        update_session_status(self.session_id, status)
        yield _evt("debate.finished", {"sessionId": self.session_id, "status": status})

    # ------------------------------------------------------------------
    # Phase 0: Evidence Retrieval
    # ------------------------------------------------------------------

    async def _run_evidence_retrieval(self) -> AsyncGenerator[dict, None]:
        """Collect evidence cards for both sides using the evidence pipeline."""
        from app.evidence.web_evidence_worker import collect_evidence_for_debate

        yield _evt("evidence.started", {
            "sessionId": self.session_id,
            "urlCount": len(self._evidence_urls),
        })

        try:
            for_cards, against_cards = await asyncio.gather(
                collect_evidence_for_debate(
                    query=self.topic,
                    urls=self._evidence_urls,
                    llm=self.llm,
                    perspective="FOR",
                    config=self._evidence_config,
                ),
                collect_evidence_for_debate(
                    query=self.topic,
                    urls=self._evidence_urls,
                    llm=self.llm,
                    perspective="AGAINST",
                    config=self._evidence_config,
                ),
            )

            self.evidence_cards["A"] = for_cards
            self.evidence_cards["B"] = against_cards

            yield _evt("evidence.ready", {
                "sessionId": self.session_id,
                "forCards": len(for_cards),
                "againstCards": len(against_cards),
                "cards": {
                    "for": [c.model_dump() for c in for_cards],
                    "against": [c.model_dump() for c in against_cards],
                },
            })
        except Exception as e:
            logger.warning("Evidence retrieval failed (non-fatal): %s", e)
            yield _evt("evidence.error", {
                "sessionId": self.session_id,
                "error": str(e),
            })

    # ------------------------------------------------------------------
    # Phase 1: Main Debate
    # ------------------------------------------------------------------

    async def _run_main_debate(self) -> AsyncGenerator[dict, None]:
        turn_count = self.config.get("turn_count", 10)
        for turn in range(turn_count):
            if self._cancelled:
                return

            agent_id = "A" if turn % 2 == 0 else "B"
            self.turn_counter[agent_id] += 1
            message_id = f"{agent_id}{self.turn_counter[agent_id]}"

            opponent_id = "B" if agent_id == "A" else "A"
            opponent_last = self._latest_message_by(opponent_id)
            reply_to = opponent_last["message_id"] if opponent_last else None

            prompt = self._debate_prompt(agent_id, opponent_last)

            async for event in self._generate_and_save_message(
                message_id=message_id, agent_id=agent_id,
                phase="debate", prompt=prompt, reply_to=reply_to,
            ):
                yield event

    # ------------------------------------------------------------------
    # Phase 2: Cross-Examination
    # ------------------------------------------------------------------

    async def _run_cross_exam(self) -> AsyncGenerator[dict, None]:
        q_per_agent = self.config.get("cross_exam_questions_per_agent", 2)

        for round_num in range(q_per_agent):
            for questioner, answerer in [("A", "B"), ("B", "A")]:
                if self._cancelled:
                    return

                opponent_latest = self._latest_message_by(answerer)
                challenges_id = opponent_latest["message_id"] if opponent_latest else None

                # Question
                q_mid = f"{questioner}_XQ{round_num + 1}"
                q_prompt = self._cross_exam_question_prompt(questioner, opponent_latest)

                async for event in self._generate_and_save_message(
                    message_id=q_mid, agent_id=questioner,
                    phase="cross_exam_question", prompt=q_prompt,
                    reply_to=challenges_id, challenges=challenges_id,
                ):
                    yield event

                # Answer (retrieve the question text from saved messages)
                q_text = next((m["text"] for m in reversed(self.messages) if m["message_id"] == q_mid), "")
                a_mid = f"{answerer}_XA{round_num + 1}"
                a_prompt = self._cross_exam_answer_prompt(answerer, q_text, q_mid)

                async for event in self._generate_and_save_message(
                    message_id=a_mid, agent_id=answerer,
                    phase="cross_exam_answer", prompt=a_prompt,
                    reply_to=q_mid, answers_question=q_mid,
                ):
                    yield event

    # ------------------------------------------------------------------
    # Phase 3: Artifacts
    # ------------------------------------------------------------------

    async def _generate_artifacts(self) -> AsyncGenerator[dict, None]:
        yield _evt("artifacts.generating", {"sessionId": self.session_id, "step": "summary"})
        summary = await self._gen_summary()
        update_artifacts(self.session_id, summary=summary)

        yield _evt("artifacts.generating", {"sessionId": self.session_id, "step": "judge"})
        judge = await self._gen_judge()
        update_artifacts(self.session_id, judge=judge)

        yield _evt("artifacts.generating", {"sessionId": self.session_id, "step": "argument_graph"})
        graph = await self._gen_argument_graph()
        update_artifacts(self.session_id, argument_graph=graph)

        yield _evt("artifacts.generating", {"sessionId": self.session_id, "step": "coverage_gaps"})
        gaps = self._compute_coverage_gaps(graph)
        update_artifacts(self.session_id, coverage_gaps=gaps)

        yield _evt("artifacts.ready", {
            "sessionId": self.session_id,
            "summary": summary,
            "judge": judge,
            "argumentGraph": graph,
            "coverageGaps": gaps,
        })

    # ------------------------------------------------------------------
    # Prompt builders
    # ------------------------------------------------------------------

    def _format_evidence_cards(self, agent_id: str) -> str:
        """Format evidence cards for injection into debate prompts."""
        cards = self.evidence_cards.get(agent_id, [])
        if not cards:
            return ""

        formatted = [
            f"  [{c.card_id}] ({c.domain}) Claim: {c.claim[:120]} | "
            f"Quote: \"{c.quote[:150]}\" | Confidence: {c.confidence:.1f}"
            for c in cards[:8]
        ]
        return "\nRetrieved Evidence (cite by card_id and quote when using):\n" + "\n".join(formatted)

    def _debate_prompt(self, agent_id: str, opponent_last: dict | None) -> str:
        agent = self.agents[agent_id]
        persona = agent["persona"]
        stance = agent["stance"]
        persp = self._perspective_instruction()
        max_sentences = self.config.get("max_sentences_per_message", 15)
        no_repeat = self.config.get("no_repetition", True)

        window = self.messages[-6:] if len(self.messages) > 6 else self.messages
        history = "\n".join(
            f"[{m['message_id']}] Agent {m['agent_id']} ({self._stance_of(m['agent_id'])}): {m['text']}"
            for m in window
        )

        opponent_ctx = ""
        if opponent_last:
            excerpt = opponent_last["text"][:500]
            opponent_ctx = f"Opponent's latest message [{opponent_last['message_id']}]: {excerpt}"
        else:
            opponent_ctx = "You are opening the debate. State your position clearly and persuasively."

        evidence_ctx = self._format_evidence_cards(agent_id)
        evidence_rule = ""
        if evidence_ctx:
            evidence_rule = (
                "- CITE evidence cards by [card_id] when making claims. "
                "Use direct quotes from evidence to strengthen arguments.\n"
            )

        return f"""You are Agent {agent_id} in a live debate. Topic: "{self.topic}"
Stance: {stance}. Persona: {persona.get('profession', 'Analyst')} — {persona.get('attitude', 'logical')}, {persona.get('style', 'formal')}.

{persp}
{evidence_ctx}

Recent exchange:
{history}

{opponent_ctx}

Rules: Be concise and human. 2–4 short sentences. Address the last point directly. No repetition. Stay in character. {evidence_rule}Maximum {max_sentences} sentences. Reply as Agent {agent_id}:"""

    def _cross_exam_question_prompt(self, questioner: str, opponent_msg: dict | None) -> str:
        persona = self.agents[questioner]["persona"]
        excerpt = (opponent_msg["text"][:300] if opponent_msg else "No prior message")
        mid = opponent_msg["message_id"] if opponent_msg else "N/A"

        return f"""Agent {questioner} cross-examining. Topic: "{self.topic}"
Opponent said [{mid}]: "{excerpt}"

Ask ONE short, pointed question (1–2 sentences). Be direct and professional:"""

    def _cross_exam_answer_prompt(self, answerer: str, question_text: str, q_mid: str) -> str:
        persona = self.agents[answerer]["persona"]
        stance = self.agents[answerer]["stance"]

        return f"""Agent {answerer} answering. Stance: {stance}. Topic: "{self.topic}"
Question [{q_mid}]: "{question_text}"

Answer in 2–3 short sentences. Direct and honest. Stay in character:"""

    # ------------------------------------------------------------------
    # Artifact generators
    # ------------------------------------------------------------------

    async def _gen_artifact(self, artifact_type: str, prompt: str, fallback: dict) -> dict:
        """Generic artifact generator with common pattern."""
        return await self._invoke_json(prompt, fallback=fallback)

    async def _gen_summary(self) -> dict:
        transcript = self._format_transcript()
        prompt = f"""Analyze this debate transcript and produce a neutral summary.
Topic: "{self.topic}"

Transcript:
{transcript}

Return ONLY valid JSON (no markdown fences):
{{
  "key_points_for": [{{"point": "...", "message_ids": ["A1"]}}],
  "key_points_against": [{{"point": "...", "message_ids": ["B1"]}}],
  "strongest_evidence": [{{"evidence": "...", "message_ids": ["A2"]}}],
  "unresolved_points": ["..."],
  "neutral_takeaway": "..."
}}"""
        return await self._gen_artifact("summary", prompt, {
            "key_points_for": [], "key_points_against": [],
            "strongest_evidence": [], "unresolved_points": [],
            "neutral_takeaway": "Summary generation failed.",
        })

    async def _gen_judge(self) -> dict:
        transcript = self._format_transcript()
        prompt = f"""You are a corporate judge evaluating a structured debate.
Topic: "{self.topic}"

Transcript:
{transcript}

Evaluate and return ONLY valid JSON (no markdown fences):
{{
  "winner": "FOR" or "AGAINST" or "DRAW",
  "rubric": {{
    "logic": 0-10,
    "evidence_quality": 0-10,
    "relevance": 0-10,
    "clarity": 0-10,
    "professional_tone": 0-10,
    "risk_compliance": 0-10
  }},
  "rationales": [{{"point": "...", "message_ids": ["A3","B4"]}}],
  "executive_recommendation": "...",
  "risks_and_compliance_notes": "..."
}}

CRITICAL: Cite specific message IDs in every rationale."""
        return await self._gen_artifact("judge", prompt, {
            "winner": "DRAW",
            "rubric": {"logic": 5, "evidence_quality": 5, "relevance": 5, "clarity": 5, "professional_tone": 5, "risk_compliance": 5},
            "rationales": [], "executive_recommendation": "Evaluation failed.",
            "risks_and_compliance_notes": "",
        })

    async def _gen_argument_graph(self) -> dict:
        transcript = self._format_transcript()
        prompt = f"""Extract all claims from this debate into a structured argument graph.
Topic: "{self.topic}"

Transcript:
{transcript}

Return ONLY valid JSON (no markdown fences):
{{
  "claims": [
    {{"claimId": "C1", "text": "...", "byAgent": "A", "messageIds": ["A2"], "type": "assertion" or "evidence" or "assumption" or "counterclaim"}}
  ],
  "relations": [
    {{"from": "C3", "to": "C1", "rel": "supports" or "refutes" or "clarifies"}}
  ]
}}"""
        graph = await self._gen_artifact("argument_graph", prompt, {"claims": [], "relations": []})
        return graph if graph.get("claims") else self._heuristic_graph()

    def _compute_coverage_gaps(self, graph: dict) -> list[dict]:
        claims = {c["claimId"]: c for c in graph.get("claims", [])}
        relations = graph.get("relations", [])

        supported_by: dict[str, list] = defaultdict(list)
        refuted_by: dict[str, list] = defaultdict(list)
        for r in relations:
            if r.get("rel") == "supports":
                supported_by[r["to"]].append(r["from"])
            elif r.get("rel") == "refutes":
                refuted_by[r["to"]].append(r["from"])

        gaps = []

        for cid, claim in claims.items():
            if claim.get("type") == "assertion" and not supported_by.get(cid):
                gaps.append({
                    "gapId": f"EG-{cid}", "type": "evidence_gap",
                    "severity": "high",
                    "relatedClaimIds": [cid],
                    "relatedMessageIds": claim.get("messageIds", []),
                    "description": f"Assertion has no supporting evidence: \"{claim['text'][:80]}\"",
                    "suggestedFollowupPrompt": f"Find evidence for or against: {claim['text'][:100]}",
                })

            if claim.get("type") in ("assertion", "evidence") and not refuted_by.get(cid):
                opponent = "B" if claim.get("byAgent") == "A" else "A"
                gaps.append({
                    "gapId": f"CG-{cid}", "type": "counter_gap",
                    "severity": "medium",
                    "relatedClaimIds": [cid],
                    "relatedMessageIds": claim.get("messageIds", []),
                    "description": f"Agent {opponent} never countered: \"{claim['text'][:80]}\"",
                    "suggestedFollowupPrompt": f"Counter-arguments to: {claim['text'][:100]}",
                })

            if claim.get("type") == "assumption":
                gaps.append({
                    "gapId": f"AG-{cid}", "type": "assumption_gap",
                    "severity": "medium",
                    "relatedClaimIds": [cid],
                    "relatedMessageIds": claim.get("messageIds", []),
                    "description": f"Assumption not qualified: \"{claim['text'][:80]}\"",
                    "suggestedFollowupPrompt": f"Examine validity of assumption: {claim['text'][:100]}",
                })

        return gaps

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _latest_message_by(self, agent_id: str) -> dict | None:
        for m in reversed(self.messages):
            if m["agent_id"] == agent_id:
                return m
        return None

    def _stance_of(self, agent_id: str) -> str:
        return self.agents.get(agent_id, {}).get("stance", "?")

    def _perspective_instruction(self) -> str:
        if self.perspective_dial < 33:
            return "PERSPECTIVE: Strict Academic — require evidence for claims, avoid speculation, prefer peer-reviewed sources, be cautious."
        elif self.perspective_dial < 66:
            return "PERSPECTIVE: Mainstream — balanced and pragmatic approach, use reputable sources, be measured."
        else:
            return "PERSPECTIVE: Fringe/Unfiltered — broader speculation allowed but MUST label speculative claims as such. Still no unsafe content."

    def _format_transcript(self) -> str:
        parts = []
        for m in self.messages:
            phase_tag = ""
            if m["phase"] == "cross_exam_question":
                phase_tag = " [Cross-Exam Q]"
            elif m["phase"] == "cross_exam_answer":
                phase_tag = " [Cross-Exam A]"
            reply = f" → replying to {m.get('reply_to_message_id', '')}" if m.get("reply_to_message_id") else ""
            parts.append(f"[{m['message_id']}] Agent {m['agent_id']} ({self._stance_of(m['agent_id'])}){phase_tag}{reply}:\n{m['text']}")
        return "\n\n".join(parts)

    def _save_message(
        self, *, message_id: str, agent_id: str, phase: str, text: str,
        reply_to: str | None = None, challenges: str | None = None,
        answers_question: str | None = None,
    ) -> dict:
        record = {
            "session_id": self.session_id,
            "message_id": message_id,
            "agent_id": agent_id,
            "phase": phase,
            "text": text,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "reply_to_message_id": reply_to,
            "challenges_message_id": challenges,
            "answers_question_id": answers_question,
        }
        self.messages.append(record)
        insert_message(record)
        return record

    async def _generate_and_save_message(
        self, *, message_id: str, agent_id: str, phase: str, prompt: str,
        reply_to: str | None = None, challenges: str | None = None,
        answers_question: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Generate message from LLM, stream deltas, save, and yield events."""
        yield _evt("message.started", {
            "sessionId": self.session_id,
            "messageId": message_id,
            "agentId": agent_id,
            "phase": phase,
            "replyToMessageId": reply_to,
            **({"challengesMessageId": challenges} if challenges else {}),
            **({"answersQuestionId": answers_question} if answers_question else {}),
        })

        full_text = ""
        async for chunk in self._stream_llm(prompt):
            full_text += chunk
            yield _evt("message.delta", {"messageId": message_id, "delta": chunk})

        record = self._save_message(
            message_id=message_id, agent_id=agent_id, phase=phase,
            text=full_text, reply_to=reply_to, challenges=challenges,
            answers_question=answers_question,
        )

        yield _evt("message.final", {
            "messageId": message_id, "fullText": full_text,
            "agentId": agent_id, "phase": phase,
            "replyToMessageId": reply_to,
            "createdAt": record["created_at"],
            **({"challengesMessageId": challenges} if challenges else {}),
            **({"answersQuestionId": answers_question} if answers_question else {}),
        })

    def _heuristic_graph(self) -> dict:
        """Fallback: split debate messages into simple claims by sentence."""
        claims = []
        for m in self.messages:
            if m["phase"] not in ("debate", "cross_exam_answer"):
                continue
            sentences = [s.strip() for s in re.split(r'[.!?]+', m["text"]) if len(s.strip()) > 20]
            for i, sent in enumerate(sentences[:3]):
                cid = f"C-{m['message_id']}-{i}"
                claims.append({
                    "claimId": cid,
                    "text": sent,
                    "byAgent": m["agent_id"],
                    "messageIds": [m["message_id"]],
                    "type": "assertion",
                })
        return {"claims": claims, "relations": []}

    async def _stream_llm(self, prompt: str) -> AsyncGenerator[str, None]:
        """Stream tokens from the LLM, yielding string chunks."""
        try:
            async for chunk in self.llm.astream(prompt):
                if self._cancelled:
                    return
                content = chunk.content if hasattr(chunk, "content") else str(chunk)
                if content:
                    yield content
        except Exception as exc:
            logger.error("LLM streaming error: %s", exc)
            yield f"\n[Error generating response: {exc}]"

    async def _invoke_json(self, prompt: str, fallback: dict) -> dict:
        """Invoke LLM and parse JSON from its response, with retry + fallback."""
        for attempt in range(2):
            try:
                resp = await asyncio.to_thread(self.llm.invoke, prompt)
                raw = resp.content if hasattr(resp, "content") else str(resp)
                raw = raw.strip()
                raw = re.sub(r'^```(?:json)?\s*', '', raw)
                raw = re.sub(r'\s*```$', '', raw)
                match = re.search(r'\{[\s\S]*\}', raw)
                if match:
                    return json.loads(match.group())
            except Exception as exc:
                logger.warning("JSON invoke attempt %d failed: %s", attempt + 1, exc)
                if attempt == 0:
                    prompt += "\n\nIMPORTANT: Return ONLY valid JSON, no markdown or explanation."
        return fallback


def _evt(event: str, data: dict) -> dict:
    return {"event": event, "data": data}
