"""
Model cascading router — routes tasks to cheap or expensive models.

Rules:
  Cheap model (gpt-4o-mini / local 8B) for:
    - query expansion
    - snippet cleaning
    - claim extraction (argument graph)
    - map stage summarization
    - outline generation

  Expensive model (user's selected model) for:
    - final report synthesis
    - final debate dialogue generation
    - judge / summary artifacts

Configurable per mode and overridable via UI settings.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from langchain_core.language_models.chat_models import BaseChatModel

logger = logging.getLogger(__name__)


class TaskTier(str, Enum):
    CHEAP = "cheap"
    MEDIUM = "medium"
    EXPENSIVE = "expensive"


TASK_TIER_MAP: dict[str, TaskTier] = {
    "query_expansion": TaskTier.CHEAP,
    "query_generation": TaskTier.CHEAP,
    "snippet_cleaning": TaskTier.CHEAP,
    "claim_extraction": TaskTier.CHEAP,
    "map_summarization": TaskTier.CHEAP,
    "outline_generation": TaskTier.CHEAP,
    "evidence_distillation": TaskTier.CHEAP,
    "consent_detection": TaskTier.CHEAP,
    "reranking": TaskTier.CHEAP,

    "debate_dialogue": TaskTier.EXPENSIVE,
    "final_synthesis": TaskTier.EXPENSIVE,
    "judge_evaluation": TaskTier.MEDIUM,
    "debate_summary": TaskTier.MEDIUM,
    "argument_graph": TaskTier.MEDIUM,
    "self_reflection": TaskTier.MEDIUM,
    "claim_verification": TaskTier.MEDIUM,

    "reduce_synthesis": TaskTier.EXPENSIVE,
    "followup_generation": TaskTier.CHEAP,
    "metadata_extraction": TaskTier.CHEAP,
}


@dataclass
class ModelCascadeConfig:
    """
    Configures which model IDs to use at each tier.
    If a tier's model_id is not set, falls back to the user's main model.
    """
    cheap_model_id: str = "openai"
    cheap_model_name: str = "gpt-4o-mini"
    medium_model_id: Optional[str] = None
    medium_model_name: Optional[str] = None
    expensive_model_id: Optional[str] = None
    expensive_model_name: Optional[str] = None
    enabled: bool = True


_DEFAULT_CASCADE = ModelCascadeConfig()


class ModelRouter:
    """
    Routes tasks to the appropriate model tier.

    Usage:
        router = ModelRouter(main_llm, cascade_config)
        llm = router.get_llm("map_summarization")
    """

    def __init__(
        self,
        main_llm: BaseChatModel,
        main_model_id: str = "openai",
        main_model_name: str = "",
        cascade_config: Optional[ModelCascadeConfig] = None,
        get_llm_fn=None,
    ):
        self._main_llm = main_llm
        self._main_model_id = main_model_id
        self._main_model_name = main_model_name
        self._config = cascade_config or _DEFAULT_CASCADE
        self._get_llm_fn = get_llm_fn
        self._cache: dict[str, BaseChatModel] = {}

    def get_llm(self, task: str) -> BaseChatModel:
        """Return the LLM instance appropriate for this task."""
        if not self._config.enabled or self._get_llm_fn is None:
            return self._main_llm

        tier = TASK_TIER_MAP.get(task, TaskTier.EXPENSIVE)

        if tier == TaskTier.CHEAP:
            model_id = self._config.cheap_model_id
            model_name = self._config.cheap_model_name
        elif tier == TaskTier.MEDIUM:
            model_id = self._config.medium_model_id or self._main_model_id
            model_name = self._config.medium_model_name or self._main_model_name
        else:
            model_id = self._config.expensive_model_id or self._main_model_id
            model_name = self._config.expensive_model_name or self._main_model_name

        cache_key = f"{model_id}:{model_name}"
        if cache_key not in self._cache:
            try:
                self._cache[cache_key] = self._get_llm_fn(model_id, model_name=model_name)
            except Exception as e:
                logger.warning(
                    "Failed to get %s model (%s:%s), falling back to main: %s",
                    tier, model_id, model_name, e,
                )
                return self._main_llm

        return self._cache[cache_key]

    def get_tier(self, task: str) -> TaskTier:
        return TASK_TIER_MAP.get(task, TaskTier.EXPENSIVE)
