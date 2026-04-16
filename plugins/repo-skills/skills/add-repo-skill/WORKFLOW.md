---
name: add-repo-skill
description: Add or update a repo-local skill in the Repo Skills plugin, including the plugin-visible skill entrypoint, optional workflow/resources, clone-local state handling, and the user-facing install, uninstall, and restart guidance needed for the new skill to appear correctly in Codex. Use when the user wants to create another skill under `plugins/repo-skills/skills/`, make skill discovery easier for this clone, or update an existing repo-local skill to follow the plugin-only design and current repo conventions.
---

# Add Repo Skill

## Overview

Use this workflow to add or update one repo-local skill in the Repo Skills plugin.

Treat the plugin as plugin-only:

- Exposed skills live under `plugins/repo-skills/skills/`.
- The plugin manifest at `plugins/repo-skills/.codex-plugin/plugin.json` should expose `./skills/`.
- Do not create or rely on `~/.codex/skills` copies for these repo-local skills.

When the user wants a new skill, implement the skill files, keep any persistent state clone-local, and tell the user the minimum install, uninstall, and restart steps needed for Codex to discover the new skill.

## Collect Inputs

Resolve these inputs from the prompt and repo context before editing:

- Skill name
- What the skill should help with
- Whether it should create code, assess code, manage documents, or drive another workflow
- Whether it needs persistent state, scripts, or reference files
- Whether it is brand new or an update to an existing skill

If the user does not provide a name, choose a short hyphenated verb-led name.

Proceed without routine clarification when the intended workflow is clear enough to implement.

## Inspect The Plugin Layout

Before editing:

1. Confirm `plugins/repo-skills/.codex-plugin/plugin.json` exists and still exposes `./skills/`.
2. Confirm `./.agents/plugins/marketplace.json` still points to `./plugins/repo-skills`.
3. Inspect nearby skills under `plugins/repo-skills/skills/` and reuse their patterns before inventing a new layout.
4. If the requested skill is related to an existing skill, prefer sharing repo-local references or scripts rather than duplicating logic.

## Create The Skill Files

Create or update the skill under:

`plugins/repo-skills/skills/<skill-name>/`

Use this structure:

- `SKILL.md` required
- `agents/openai.yaml` recommended
- `WORKFLOW.md` when the skill needs more than a short entrypoint
- `references/` for detailed docs or clone-local state files
- `scripts/` for deterministic helpers that should not be rewritten ad hoc

Prefer the current repo pattern:

1. Keep `SKILL.md` short and plugin-visible.
2. Put the full operating procedure in `WORKFLOW.md` when the process is substantial.
3. Make `SKILL.md` tell Codex to read `WORKFLOW.md`.
4. Add `agents/openai.yaml` with a human-facing display name, short description, and default prompt.

## State And Sharing Conventions

Keep all persistent state clone-local.

Follow these rules:

- Store checked-in default templates under the owning skill directory, usually in `references/defaults.md`, and keep mutable clone-local state in a gitignored sibling such as `references/defaults.local.md`.
- If several related skills share state, keep that state in one repo-local owning skill directory and reference the local state file with relative links such as `../pr/references/defaults.local.md`, falling back to the checked-in template when the local file does not exist yet.
- Do not store persistent state in `~/.codex/skills`, plugin cache folders, temp files under the home directory, or absolute per-user paths.
- Do not hardcode `/Users/...` skill paths in instructions or scripts.
- When a script needs a state file, resolve it relative to the script location, for example `SCRIPT_DIR.parent / "references" / "defaults.md"`.
- When prose or code examples need to invoke a helper script, resolve the repo root first and then call the script through the repo-local plugin path:

```bash
repo_root="$(git rev-parse --show-toplevel)"
python3 "$repo_root/plugins/repo-skills/skills/<skill-name>/scripts/helper.py"
```

- If the skill does not need persistent state, do not create placeholder defaults files.

## Authoring Guidelines

Match the repo plugin conventions:

- Use lowercase hyphenated skill names.
- Write the frontmatter `name` and `description` so the trigger conditions are explicit.
- Keep `SKILL.md` concise and push detailed procedure or long references into `WORKFLOW.md` or `references/`.
- Reuse existing helper scripts and references when they already solve the problem.
- Add only the files that materially support the skill.
- Prefer ASCII unless the surrounding files already use other characters.

If the skill updates Codex-facing discovery behavior, keep the public skill names unique within the plugin.

## Discovery And User Guidance

After adding or updating the skill, tell the user what Codex needs in order to discover it.

Use these rules:

- If the plugin is not currently installed for the workspace, tell the user to install `Repo Skills` from the repo-local marketplace and then restart Codex.
- If the plugin is already installed and you changed the exposed skill set or plugin metadata, tell the user to restart Codex.
- If a restart still does not show the new skill, tell the user to uninstall the plugin, restart Codex, install the plugin again, and restart once more.
- If the currently running Codex instance is using a cached installed copy and immediate validation matters, update the live cache copy too when it is safe to do so, then still tell the user a restart is needed.

Do not tell the user to activate or copy the skill into `~/.codex/skills`.

## Validation

Validate by inspection unless the user asks for more:

1. Confirm the plugin manifest still points to `./skills/`.
2. Confirm the new skill directory contains the intended `SKILL.md` and any required `WORKFLOW.md`, `references/`, `scripts/`, or `agents/openai.yaml`.
3. Confirm the skill frontmatter `name` matches the directory purpose and intended invocation.
4. Confirm any persistent state path is repo-local and any helper script resolves files relative to its own directory.
5. Confirm the repo-local marketplace still points at `./plugins/repo-skills`.
6. If a live cached plugin copy exists and you updated it, confirm the same new skill files exist there too.

When reporting back, summarize:

- what files were added or changed
- what install or restart step the user should take next
- what you validated by inspection

## Prompt Shape

Use the skill when the user asks for a new repo-local plugin skill or to update one.

Examples:

```text
Add a repo-local skill named add-release-skill for creating release workflow skills.
```

```text
Update the repo-local assess-plan skill to share more state with PR.
```
