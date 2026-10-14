#!/usr/bin/env python3
"""Inject the appropriate repo skill into each custom subagent's context."""

import json
import sys


SKILLS = {
    "planner": (
        "$plan-banking-change",
        ".agents/skills/plan-banking-change/SKILL.md",
    ),
    "developer": (
        "$implement-banking-change",
        ".agents/skills/implement-banking-change/SKILL.md",
    ),
    "test": (
        "$test-banking-api",
        ".agents/skills/test-banking-api/SKILL.md",
    ),
}


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, TypeError):
        return

    role = str(event.get("agent_type", "")).lower()
    skill = SKILLS.get(role)
    if skill is None:
        return

    skill_name, skill_path = skill
    context = (
        f"Use the {skill_name} repository skill for this role. "
        f"Read `{skill_path}` completely before taking task actions and follow its output contract."
    )
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "SubagentStart",
                    "additionalContext": context,
                }
            }
        )
    )


if __name__ == "__main__":
    main()
