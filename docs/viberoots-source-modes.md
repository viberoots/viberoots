# viberoots Source Mode Commands

This document drafts the source-mode management commands for bootstrapped consumer workspaces.
Bootstrap remains the create and upgrade entrypoint. The `viberoots` CLI should own day-to-day
switching between flake consumption and submodule contribution mode.

## Commands

```bash
viberoots use-submodule
viberoots use-flake
viberoots use-flake --remove-submodule
viberoots remove-submodule
viberoots remove-submodule --dry-run
viberoots help
viberoots completion bash
```

## Core Invariant

`.viberoots/current` is the active source pointer.

- Submodule mode: `.viberoots/current -> ../viberoots`
- Flake mode: `.viberoots/current` points to the materialized flake source after activation.

Generated files are repaired idempotently for the selected mode. Consumer-authored files are
preserved.

Generated workspace flakes look for
`.viberoots/workspace/nixpkgs-source-registry-extension.nix` and pass its `profiles` into
`inputs.viberoots.lib.mkWorkspace`. Generated consumer flakes expose the lockfile-backed
`nixpkgs_23_11` input so consumers can add reviewed profile entries through that extension file
without copying viberoots registry files into `projects/`.

## `viberoots use-submodule`

Switches an existing workspace to local contribution mode.

Behavior:

- Requires a git workspace.
- If `viberoots/` is an existing submodule, run `git submodule update --init viberoots`.
- If `viberoots/` is absent, run `git submodule add <url> viberoots`.
- If `viberoots/` exists but is not a submodule, refuse with remediation.
- Non-default submodule URLs require explicit trust confirmation.
- Reuse `initConsumer(...)` in submodule mode.
- Repair `.viberoots/current -> ../viberoots`.
- Preserve docs and project config.
- Print:

```bash
direnv reload
i && b && v
```

Options:

```bash
viberoots use-submodule --url <git-url>
viberoots use-submodule --trust-url
viberoots use-submodule --no-direnv
viberoots use-submodule --run-install
```

## `viberoots use-flake`

Switches an existing workspace back to remote/pinned flake consumption mode.

Behavior:

- Reuse `initConsumer(...)` in flake mode.
- Remove the local source override from generated `.envrc`.
- Lock consumed viberoots from `--ref`, `VBR_REF`, or the default `main`; alternatively preserve
  the current locked ref if that becomes the chosen policy.
- Do not delete or mutate top-level `viberoots/`.
- If an inactive submodule remains, print:

```bash
viberoots remove-submodule
viberoots remove-submodule --dry-run
```

Default `use-flake` preserves the submodule so temporary switching is reversible.

Options:

```bash
viberoots use-flake --ref <tag-or-commit>
viberoots use-flake --remove-submodule
viberoots use-flake --no-direnv
viberoots use-flake --run-install
```

Even when the `viberoots/` submodule has no local worktree changes, automatic removal is not fully
reversible. It can lose or alter:

- exact submodule URL
- exact gitlink commit
- branch tracking config
- custom submodule path or name config
- local `.git/config` submodule settings
- staged `.gitmodules` or gitlink state

Therefore default `use-flake` should switch only the active source mode.

## `viberoots use-flake --remove-submodule`

One-command switch plus cleanup for users who explicitly want the repo to stop carrying the
submodule.

Behavior:

- First perform `use-flake`.
- Then run the same implementation as `viberoots remove-submodule`.
- Refuse unless:
  - `viberoots/` is a real submodule;
  - `.viberoots/current` no longer points at `../viberoots`;
  - the submodule working tree is clean;
  - `.gitmodules` and the `viberoots` gitlink do not have unexpected staged or dirty state.
- Never commit automatically.
- Print `git status --short` and commit guidance.

## `viberoots remove-submodule`

Removes an inactive viberoots submodule.

The command name is destructive enough, so no extra `--apply` flag or prompt is required. Safety
comes from strict guardrails.

Behavior:

```bash
git submodule deinit -f viberoots
git rm -f viberoots
rm -rf .git/modules/viberoots
git status --short
```

Refusals:

- Refuse if `.viberoots/current -> ../viberoots`.
- Refuse if `viberoots/` has local changes.
- Refuse if `viberoots/` is not a submodule; for a plain checkout, print that deleting
  `viberoots/` is enough.
- Refuse on unexpected staged or dirty `.gitmodules` or gitlink state.

`--dry-run` prints the planned commands and detected state without making mutations.

Post-run output:

```bash
git status --short
git commit -m "remove viberoots submodule"
```

## Help

`viberoots help` should be a first-class command.

It should list:

```text
viberoots status
viberoots bootstrap-check
viberoots bootstrap
viberoots update
viberoots gc
viberoots init-consumer
viberoots use-submodule
viberoots use-flake
viberoots remove-submodule
viberoots completion bash
viberoots help
```

Each command should include one-line usage and options. Unknown commands should print a concise
error plus `viberoots help`.

## Bash Completion

Add bash completion for `viberoots` and its short `vbr` wrapper.

Completion should cover commands:

```text
status bootstrap-check bootstrap update gc init-consumer use-submodule use-flake remove-submodule completion help
```

Maintenance command details live in [`viberoots-maintenance-commands.md`](viberoots-maintenance-commands.md).

Completion should cover `use-submodule` options:

```text
--url --trust-url --no-direnv --run-install --help
```

Completion should cover `use-flake` options:

```text
--ref --remove-submodule --no-direnv --run-install --help
```

Completion should cover `remove-submodule` options:

```text
--dry-run --help
```

Existing `init-consumer` options should remain covered if completion infrastructure already exists.
Otherwise, add them as part of this work.

Preferred implementation:

```bash
viberoots completion bash
```

Completion should be generated from the CLI command metadata so help text and completion do not
drift. The generated script should register the same function for `viberoots` and `vbr`.

## Generated File Behavior

All source-mode commands should use the existing bootstrap file policy:

- Generated files may be repaired.
- Non-generated generated-path collisions are backed up.
- `README.md`, `projects/README.md`, `projects/AGENTS.md`, and
  `projects/config/README.md` are missing-only.
- `projects/config/shared.json` is create-only.
- `projects/config/local.json` is merge/update and gitignored.
- `.gitignore` is amended with local workspace/config ignores if missing.

## Crash Safety

Reuse bootstrap transaction machinery.

Record:

- operation: `use-submodule`, `use-flake`, or `remove-submodule`
- from mode
- to mode
- current `.viberoots/current` target
- requested URL or ref
- submodule path, URL, and gitlink before removal
- owner PID
- timestamp

Recovery:

- Re-running bootstrap, `i`, or `viberoots bootstrap-check` repairs generated workspace state.
- For interrupted removal, rerun `viberoots remove-submodule`; operations must be idempotent where
  possible.
- Do not attempt to reconstruct deleted submodule state automatically unless enough state was
  recorded and the tool can prove restoration is safe.

## Implementation Shape

- Extend `build-tools/tools/dev/viberoots.ts`.
- Add a source-mode library such as `build-tools/tools/lib/consumer-source-mode.ts`.
- Keep git commands injectable and testable.
- Reuse `initConsumer(...)`.
- Add command metadata once and use it for both help and completion.

Helpers:

- `detectSubmodule(path)`
- `submoduleDirty(path)`
- `currentPointsAtSubmodule(workspaceRoot)`
- `useSubmodule(opts)`
- `useFlake(opts)`
- `planRemoveSubmodule(opts)`
- `removeSubmodule(opts)`

## Test Coverage

### Help

- `viberoots help` exits 0 and lists all commands.
- Unknown commands exit nonzero and point to `viberoots help`.
- Command-specific `--help` works for new commands.

### Completion

- `viberoots completion bash` emits a bash completion function.
- Completion output contains all commands.
- Completion output contains command-specific options.
- Snapshot or contract test prevents drift between help metadata and completion metadata.

### `use-submodule`

- Adds submodule when absent.
- Initializes existing submodule without re-adding.
- Refuses non-submodule `viberoots/`.
- Refuses untrusted custom URL.
- Accepts trusted custom URL.
- Repairs `.viberoots/current -> ../viberoots`.
- Preserves docs and config.

### `use-flake`

- Switches generated files to flake mode.
- Removes local source override from `.envrc`.
- Leaves existing submodule untouched by default.
- Prints removal guidance when inactive submodule remains.
- Honors `--ref` and `VBR_REF`.
- Preserves docs/config and local config ignore policy.

### `use-flake --remove-submodule`

- Performs mode switch, then cleanup.
- Refuses dirty submodule.
- Refuses unexpected `.gitmodules` or gitlink dirty/staged state.
- Does not commit.
- Prints status and commit guidance.

### `remove-submodule`

- `--dry-run` prints commands and makes no mutations.
- Refuses while active source points at `../viberoots`.
- Refuses dirty submodule.
- Plain non-submodule checkout gets "delete directory manually" guidance.
- Command runs deinit/rm/module cleanup when safe.
- Missing `.git/modules/viberoots` is okay.
- No automatic commit.

### Regression

- Existing bootstrap flake/submodule tests still pass.
- `bootstrap-check` still repairs half-completed generated state.
- `viberoots status` reports active source mode and inactive submodule hint.
- Formatting and diff whitespace checks pass.
