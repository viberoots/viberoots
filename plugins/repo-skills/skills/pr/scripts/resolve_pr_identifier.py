#!/usr/bin/env python3
"""Resolve and persist the numeric PR identifier used by the pr skill."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULTS_PATH = SCRIPT_DIR.parent / "references" / "defaults.md"
LAST_PR_LINE_PREFIX = "- `last_pr_numeric_argument`:"
PR_IDENTIFIER_RE = re.compile(r"^\d+(?:\.\d+)*$")
UNSET_VALUES = {"", "unset"}


def parse_identifier(value: str) -> list[int]:
    if not PR_IDENTIFIER_RE.fullmatch(value):
        raise ValueError(
            "PR identifier must be numeric, using digits with optional dot separators "
            "(examples: 7, 4.5, 4.5.1).",
        )
    return [int(part) for part in value.split(".")]


def increment_identifier(value: str) -> str:
    parts = parse_identifier(value)
    parts[-1] += 1
    return ".".join(str(part) for part in parts)


def read_last_identifier(defaults_path: Path) -> str | None:
    for line in defaults_path.read_text().splitlines():
        if line.startswith(LAST_PR_LINE_PREFIX):
            raw_value = line.split("`")[-2].strip()
            if raw_value.lower() in UNSET_VALUES:
                return None
            parse_identifier(raw_value)
            return raw_value
    return None


def write_last_identifier(defaults_path: Path, identifier: str) -> None:
    parse_identifier(identifier)
    replacement = f"{LAST_PR_LINE_PREFIX} `{identifier}`"

    lines = defaults_path.read_text().splitlines()
    updated_lines = []
    replaced = False
    for line in lines:
        if line.startswith(LAST_PR_LINE_PREFIX):
            updated_lines.append(replacement)
            replaced = True
        else:
            updated_lines.append(line)

    if not replaced:
        updated_lines.append(replacement)

    defaults_path.write_text("\n".join(updated_lines) + "\n")


def resolve_identifier(defaults_path: Path, explicit_identifier: str | None) -> str:
    if explicit_identifier is not None:
        parse_identifier(explicit_identifier)
        return explicit_identifier

    last_identifier = read_last_identifier(defaults_path)
    if last_identifier is None:
        raise ValueError(
            "No last PR identifier is recorded yet. Run this script once with an explicit "
            "numeric identifier, such as 4.5.1, before relying on the implicit default.",
        )
    return increment_identifier(last_identifier)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Resolve the numeric PR identifier for the pr skill, persisting the explicit value "
            "or the next default derived from the last recorded identifier."
        ),
    )
    parser.add_argument(
        "pr_identifier",
        nargs="?",
        help="Explicit numeric PR identifier to persist, such as 4.5.1",
    )
    parser.add_argument(
        "--file",
        default=str(DEFAULTS_PATH),
        help="Defaults markdown file to read and update",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    defaults_path = Path(args.file).resolve()
    identifier = resolve_identifier(defaults_path, args.pr_identifier)
    write_last_identifier(defaults_path, identifier)
    print(identifier)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
