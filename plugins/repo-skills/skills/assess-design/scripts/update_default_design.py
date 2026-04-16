#!/usr/bin/env python3
"""Persist the `assess-design` default design document."""

from __future__ import annotations

import argparse
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULTS_TEMPLATE_PATH = SCRIPT_DIR.parent / "references" / "defaults.md"
DEFAULTS_PATH = SCRIPT_DIR.parent / "references" / "defaults.local.md"
DEFAULT_LINE_PREFIX = "- `default_design_document`:"


def ensure_defaults_path(defaults_path: Path) -> Path:
    if defaults_path.exists():
        return defaults_path
    defaults_path.parent.mkdir(parents=True, exist_ok=True)
    defaults_path.write_text(DEFAULTS_TEMPLATE_PATH.read_text())
    return defaults_path


def update_defaults(defaults_path: Path, design_document: str) -> None:
    defaults_path = ensure_defaults_path(defaults_path)
    content = defaults_path.read_text()
    replacement = f"{DEFAULT_LINE_PREFIX} `{design_document}`"

    if DEFAULT_LINE_PREFIX not in content:
        raise ValueError(f"Could not find {DEFAULT_LINE_PREFIX!r} in {defaults_path}")

    lines = content.splitlines()
    updated_lines = []
    replaced = False
    for line in lines:
        if line.startswith(DEFAULT_LINE_PREFIX):
            updated_lines.append(replacement)
            replaced = True
        else:
            updated_lines.append(line)

    if not replaced:
        raise ValueError(f"Could not replace default design document in {defaults_path}")

    defaults_path.write_text("\n".join(updated_lines) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Update the `assess-design` fallback design document.",
    )
    parser.add_argument("design_document", help="Repository-relative design document path")
    parser.add_argument(
        "--file",
        default=str(DEFAULTS_PATH),
        help="Local defaults markdown file to update",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    defaults_path = Path(args.file).resolve()
    update_defaults(defaults_path, args.design_document)
    print(f"Updated default design document to {args.design_document}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
