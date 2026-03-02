"""
Assistant personas: backend-defined "AI team" roles.
Names and copy are configurable here; frontend renders from GET /api/assistant/personas only.
Extensible for future marketplace/plugins.
"""

from __future__ import annotations

from typing import Any

# Persona id → capabilities (tool groups). Used to compute status and filter tools.
CAPABILITY_RESEARCH = "research"
CAPABILITY_FILES = "files"
CAPABILITY_EMAIL = "email"
CAPABILITY_CALENDAR = "calendar"
CAPABILITY_TASKS = "tasks"
CAPABILITY_ACTIONS = "actions"  # executor: fs, notes, clipboard, shell

# Requires-setup keys (must match frontend connector names for status resolution).
REQUIRES_EMAIL = "email"
REQUIRES_CALENDAR = "calendar"


def get_personas_config() -> list[dict[str, Any]]:
    """
    Return the list of persona definitions (without status).
    Status is computed in the API from executor and connector state.
    """
    return [
        {
            "persona_id": "research_analyst",
            "display_name": "Research Analyst",
            "icon_key": "search",
            "description": "Query past searches and synthesise findings.",
            "example_prompts": [
                "Summarise my most recent research sessions.",
                "What were the key findings across my recent searches?",
                "Compare and contrast the topics I've recently researched.",
                "What knowledge gaps exist in my research so far?",
            ],
            "capabilities": [CAPABILITY_RESEARCH],
            "requires_setup": [],
        },
        {
            "persona_id": "digital_archivist",
            "display_name": "Digital Archivist",
            "icon_key": "folder",
            "description": "Scan, organise, clean and manage local files.",
            "example_prompts": [
                "Scan folder",
                "Please list down the CSV files.",
                "Organise my files into categorised subfolders.",
                "Remove large files from my scanned folder.",
                "Remove duplicate files.",
                "Archive old stale files.",
            ],
            "capabilities": [CAPABILITY_FILES, CAPABILITY_ACTIONS],
            "requires_setup": [],
        },
        {
            "persona_id": "inbox_guardian",
            "display_name": "Inbox Guardian",
            "icon_key": "mail",
            "description": "Summarise, clean, draft and triage your inbox.",
            "example_prompts": [
                "Summarise my unread emails and highlight anything urgent.",
                "Identify newsletters and low-priority emails I can archive.",
                "Help me draft a professional reply to the latest email.",
                "Search my inbox for emails about ",
            ],
            "capabilities": [CAPABILITY_EMAIL],
            "requires_setup": [REQUIRES_EMAIL],
        },
        {
            "persona_id": "time_strategist",
            "display_name": "Time Strategist",
            "icon_key": "calendar",
            "description": "Schedule events and view your agenda.",
            "example_prompts": [
                "Show me my agenda for today.",
                "Give me a summary of my schedule this week.",
                "Add event: ",
                "Find my free time slots for today.",
            ],
            "capabilities": [CAPABILITY_CALENDAR],
            "requires_setup": [REQUIRES_CALENDAR],
        },
        {
            "persona_id": "documentation_assistant",
            "display_name": "Documentation Assistant",
            "icon_key": "list",
            "description": "Track to-dos, notes and manage lists.",
            "example_prompts": [
                "Add task: ",
                "Show all my pending tasks.",
                "What should I work on next based on my task list?",
                "Clear all completed tasks.",
            ],
            "capabilities": [CAPABILITY_TASKS],
            "requires_setup": [],
        },
        {
            "persona_id": "fact_checker",
            "display_name": "Fact Checker",
            "icon_key": "zap",
            "description": "Take real actions: files, notes, clipboard, shell.",
            "example_prompts": [
                "List files in my home directory.",
                "Read the file ",
                "Create a note titled ",
                "Search my notes for ",
                "Copy to clipboard: ",
            ],
            "capabilities": [CAPABILITY_ACTIONS],
            "requires_setup": [],
        },
    ]
