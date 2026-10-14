#!/usr/bin/env python3
"""Block a narrow set of destructive shell commands in this repository."""

import json
import re
import sys


COMMAND_BOUNDARY = r"(?:^|(?:&&|\|\||;|\n)\s*)"
BLOCKED = (
    (
        re.compile(COMMAND_BOUNDARY + r"(?:sudo\s+)?git\s+reset\s+--hard\b", re.I),
        "git reset --hard can discard user work",
    ),
    (
        re.compile(
            COMMAND_BOUNDARY
            + r"(?:sudo\s+)?git\s+clean\s+(?:[^\n;&|]*\s)?(?:-[A-Za-z]*f[A-Za-z]*|--force)\b",
            re.I,
        ),
        "forced git clean can delete untracked user files",
    ),
    (
        re.compile(COMMAND_BOUNDARY + r"(?:sudo\s+)?git\s+(?:checkout|restore)\s+--\s+", re.I),
        "git checkout/restore -- can discard user changes",
    ),
    (
        re.compile(
            COMMAND_BOUNDARY
            + r"(?:npx\s+|npm\s+exec\s+--\s+)?prisma\s+migrate\s+reset\b",
            re.I,
        ),
        "prisma migrate reset destroys the current database",
    ),
    (
        re.compile(
            COMMAND_BOUNDARY
            + r"(?:sudo\s+)?rm\s+[^\n;&|]*(?:backend/prisma/[^\s]*\.db|backend/prisma/dev\.db)\b",
            re.I,
        ),
        "direct database-file deletion is not part of the agent workflow",
    ),
)


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, TypeError):
        return

    command = str((event.get("tool_input") or {}).get("command", ""))
    for pattern, reason in BLOCKED:
        if pattern.search(command):
            print(
                json.dumps(
                    {
                        "hookSpecificOutput": {
                            "hookEventName": "PreToolUse",
                            "permissionDecision": "deny",
                            "permissionDecisionReason": (
                                f"Blocked by repository hook: {reason}. "
                                "Use a non-destructive alternative or ask the user for explicit direction."
                            ),
                        }
                    }
                )
            )
            return


if __name__ == "__main__":
    main()
