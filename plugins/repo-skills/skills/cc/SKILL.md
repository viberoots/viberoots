---
name: cc
description: Commit all uncommitted or local git changes in the current repository with a single conventional commit whose message accurately represents the full change set. Assume required tests and validation have already been performed before this skill is invoked, so commit immediately after inspecting and staging unless blocked by git state or obviously unrelated work. Use when the user asks to commit current work, commit everything locally, create a conventional commit, or make a representative snapshot of the working tree before handing off.
---

# Commit Changes

Use this plugin skill as the direct entrypoint for committing the current working tree.

1. Read [WORKFLOW.md](WORKFLOW.md) and use it as the source of truth for the rest of the task.
2. Read only the references and scripts that `WORKFLOW.md` asks for.
3. Keep any repo-specific context or state in the current clone, not in `~/.codex/skills`.
