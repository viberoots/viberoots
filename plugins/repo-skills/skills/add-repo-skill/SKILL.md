---
name: add-repo-skill
description: Add or update a repo-local skill in the Repo Skills plugin, including the plugin-visible skill entrypoint, optional workflow/resources, clone-local state handling, and the user-facing install, uninstall, and restart guidance needed for the new skill to appear correctly in either Codex or Claude Code. Use when the user wants to create another skill under `plugins/repo-skills/skills/`, make skill discovery easier for this clone, or update an existing repo-local skill to follow the plugin-only design and current repo conventions.
---

# Add Repo Skill

Use this plugin skill as the direct entrypoint for adding or updating a repo-local skill.

1. Read [WORKFLOW.md](WORKFLOW.md) and use it as the source of truth for the rest of the task.
2. Read only the references and scripts that `WORKFLOW.md` asks for.
3. Keep persistent state in repo-local files under `plugins/repo-skills/skills/`, not in user-global plugin or skill caches.
