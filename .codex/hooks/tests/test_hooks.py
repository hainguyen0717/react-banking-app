import json
import subprocess
import unittest
from pathlib import Path
from typing import Optional


HOOKS_DIR = Path(__file__).resolve().parents[1]


def run_hook(script_name: str, event: dict) -> Optional[dict]:
    result = subprocess.run(
        ["/usr/bin/python3", str(HOOKS_DIR / script_name)],
        input=json.dumps(event),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout) if result.stdout else None


class SubagentContextTests(unittest.TestCase):
    def test_routes_each_custom_role_to_its_skill(self) -> None:
        expected = {
            "planner": "$plan-banking-change",
            "developer": "$implement-banking-change",
            "test": "$test-banking-api",
        }

        for role, skill_name in expected.items():
            with self.subTest(role=role):
                output = run_hook(
                    "subagent_context.py",
                    {"hook_event_name": "SubagentStart", "agent_type": role},
                )
                context = output["hookSpecificOutput"]["additionalContext"]
                self.assertIn(skill_name, context)

    def test_ignores_unknown_roles(self) -> None:
        output = run_hook(
            "subagent_context.py",
            {"hook_event_name": "SubagentStart", "agent_type": "explorer"},
        )
        self.assertIsNone(output)


class SafetyGuardTests(unittest.TestCase):
    def test_blocks_destructive_commands(self) -> None:
        commands = (
            "git reset --hard HEAD",
            "git clean -fd",
            "git checkout -- frontend/src/App.tsx",
            "npx prisma migrate reset",
            "rm backend/prisma/dev.db",
        )

        for command in commands:
            with self.subTest(command=command):
                output = run_hook(
                    "safety_guard.py",
                    {
                        "hook_event_name": "PreToolUse",
                        "tool_input": {"command": command},
                    },
                )
                decision = output["hookSpecificOutput"]
                self.assertEqual(decision["permissionDecision"], "deny")

    def test_allows_normal_verification(self) -> None:
        output = run_hook(
            "safety_guard.py",
            {
                "hook_event_name": "PreToolUse",
                "tool_input": {"command": "npm test"},
            },
        )
        self.assertIsNone(output)


if __name__ == "__main__":
    unittest.main()
