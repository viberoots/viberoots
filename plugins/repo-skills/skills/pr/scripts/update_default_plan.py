#!/usr/bin/env python3
"""Persist the shared default spec or plan document used by related skills."""

from __future__ import annotations

import argparse
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULTS_PATH = SCRIPT_DIR.parent / "references" / "defaults.md"
DEFAULT_LINE_PREFIX = "- `default_plan_document`:"
LAST_PR_LINE_PREFIX = "- `last_pr_numeric_argument`:"
RESET_PR_VALUE = "0"


def update_defaults(defaults_path: Path, plan_document: str) -> None:
    content = defaults_path.read_text()
    plan_replacement = f"{DEFAULT_LINE_PREFIX} `{plan_document}`"

    if DEFAULT_LINE_PREFIX not in content:
        raise ValueError(f"Could not find {DEFAULT_LINE_PREFIX!r} in {defaults_path}")

    lines = content.splitlines()
    updated_lines = []
    replaced_plan = False
    replaced_last_pr = False
    plan_changed = False
    for line in lines:
        if line.startswith(DEFAULT_LINE_PREFIX):
            current_plan_document = line.split("`")[-2].strip()
            plan_changed = current_plan_document != plan_document
            updated_lines.append(plan_replacement)
            replaced_plan = True
        elif line.startswith(LAST_PR_LINE_PREFIX) and plan_changed:
            updated_lines.append(f"{LAST_PR_LINE_PREFIX} `{RESET_PR_VALUE}`")
            replaced_last_pr = True
        else:
            updated_lines.append(line)

    if not replaced_plan:
        raise ValueError(f"Could not replace default plan document in {defaults_path}")

    if plan_changed and not replaced_last_pr:
        updated_lines.append(f"{LAST_PR_LINE_PREFIX} `{RESET_PR_VALUE}`")

    defaults_path.write_text("\n".join(updated_lines) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Update the shared fallback spec or plan document for related skills. "
            "When the saved default plan document changes, reset the pr skill's last "
            "numeric argument to 0."
        ),
    )
    parser.add_argument("plan_document", help="Repository-relative plan document path")
    parser.add_argument(
        "--file",
        default=str(DEFAULTS_PATH),
        help="Defaults markdown file to update",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    defaults_path = Path(args.file).resolve()
    update_defaults(defaults_path, args.plan_document)
    print(f"Updated default plan document to {args.plan_document}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
