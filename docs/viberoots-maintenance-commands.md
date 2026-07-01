# viberoots Bootstrap and Maintenance Commands

This document proposes the CLI design for `viberoots bootstrap`, `viberoots update`, and `viberoots gc`.

The goals are:

- Make bootstrap and upgrade discoverable from the installed `viberoots` CLI.
- Keep bootstrap migration authority on the latest live script from GitHub `main`.
- Provide a conservative cleanup command that follows Nix best practices and removes only viberoots-owned local state that is safe to regenerate.
- Keep destructive behavior explicit, previewable, and documented.

## Commands

```bash
viberoots bootstrap
viberoots update
viberoots gc
viberoots gc --dry-run
viberoots gc --aggressive
viberoots gc --optimize
viberoots gc --nix-delete-older-than 7d
```

`viberoots bootstrap` and `viberoots update` are aliases for the same latest-main bootstrap path.

`viberoots gc` is a local maintenance command. It must never remove source files, committed files, user-authored project files, local secrets, or dirty work.

## `viberoots bootstrap` and `viberoots update`

### User Contract

Both commands invoke the latest bootstrap script from GitHub `main`, regardless of the currently installed or checked-out viberoots version.

```bash
viberoots bootstrap
viberoots update
```

This ensures upgrade migrations are always sourced from the newest bootstrap entrypoint.

The current local CLI should act only as a downloader/launcher. It should not try to duplicate bootstrap logic.

### Source URL

Default script URL:

```text
https://raw.githubusercontent.com/viberoots/viberoots/main/bootstrap
```

The command should allow a test-only or advanced override for local validation:

```bash
viberoots bootstrap --bootstrap-url <url>
viberoots update --bootstrap-url <url>
```

Documentation should present the default path only. The override is for tests, development, and emergency recovery.

### Environment Forwarding

The launcher should preserve the existing bootstrap environment contract:

| Environment variable  | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `VBR_CONSUMER`        | `flake` or `submodule` source mode.             |
| `VBR_REF`             | Target viberoots ref consumed by the workspace. |
| `VBR_WORKSPACE_ROOT`  | Consumer workspace root.                        |
| `VBR_INSTALL_NIX`     | Whether bootstrap may install Nix if missing.   |
| `VBR_RUN_INSTALL`     | Whether bootstrap runs `i`.                     |
| `VBR_RUN_VALIDATE`    | Whether bootstrap runs `b && v`.                |
| `VBR_DIRENV_ALLOW`    | Whether bootstrap runs `direnv allow`.          |
| `VBR_DRY_RUN`         | Preview bootstrap actions.                      |
| `VBR_SUBMODULE`       | Submodule Git URL.                              |
| `VBR_TRUST_SUBMODULE` | Trust a non-default submodule URL.              |

The launcher should not reinterpret most of these options. It should pass the environment through and let the live bootstrap script own semantics.

### CLI Flags

The launcher should provide a small flag surface that maps to the existing environment variables for discoverability:

```bash
viberoots bootstrap --mode flake
viberoots bootstrap --mode submodule
viberoots bootstrap --ref <tag-or-commit>
viberoots bootstrap --workspace-root <path>
viberoots bootstrap --run-install
viberoots bootstrap --no-run-install
viberoots bootstrap --run-validate
viberoots bootstrap --no-direnv-allow
viberoots bootstrap --dry-run
```

`viberoots update` should accept the same flags.

The launcher should translate flags to `VBR_*` variables before invoking the downloaded script. Explicit environment variables should remain supported. A CLI flag wins over an existing environment variable for the launched process because it represents the user’s direct command invocation.

### Execution Model

Preferred implementation:

1. Resolve the bootstrap URL.
2. Download the script to a temporary file under a viberoots-owned temp directory.
3. Validate basic transport success:
   - non-empty response;
   - starts with a shell shebang or expected bootstrap marker;
   - HTTP failures fail closed.
4. Execute the temp file with `bash`.
5. Forward stdout/stderr without wrapping.
6. Delete the temp file after execution.

Avoid piping directly from `curl` to `bash` inside the implementation. A temp file makes error reporting, tests, and basic validation easier while preserving the public curlable bootstrap story.

The command should print a short preflight line before execution:

```text
viberoots bootstrap: running latest bootstrap script from GitHub main
```

For non-default `--bootstrap-url`, print:

```text
viberoots bootstrap: running bootstrap script from <url>
```

### Trust and Safety

`viberoots bootstrap` intentionally runs code fetched from the bootstrap URL. The default URL is controlled by the viberoots project.

If `--bootstrap-url` is not the official GitHub main URL, require explicit acknowledgement:

```bash
viberoots bootstrap --bootstrap-url <url> --trust-bootstrap-url
```

Without `--trust-bootstrap-url`, fail with a message explaining that a custom bootstrap URL can run non-viberoots code during setup.

This mirrors the existing submodule URL trust posture.

### Offline and Failure Behavior

If the latest bootstrap script cannot be fetched, fail closed with remediation:

```text
error: could not fetch viberoots bootstrap from GitHub main
next: check network access, or run the documented curl command manually when connectivity returns
```

Do not silently fall back to the local bootstrap copy, because that would violate the upgrade invariant that migrations come from the latest main script.

An explicit local path override may be used for development:

```bash
viberoots bootstrap --bootstrap-url file:///path/to/bootstrap --trust-bootstrap-url
```

### Help and Completion

Update `viberoots help` and `viberoots completion bash` to include:

```text
bootstrap update gc
```

Command-specific completion:

```text
bootstrap/update: --mode --ref --workspace-root --run-install --no-run-install --run-validate --no-direnv-allow --dry-run --bootstrap-url --trust-bootstrap-url --help
gc: --dry-run --aggressive --optimize --nix --no-nix --nix-delete-older-than --keep-current-profile --verbose --help
```

## `viberoots gc`

### User Contract

`viberoots gc` performs conservative local cleanup:

- Nix cleanup using current best-practice commands.
- viberoots-owned generated state cleanup that can be regenerated.
- No removal of source files, project files, local secrets, committed files, or dirty work.

Default mode should be safe enough to run during normal maintenance:

```bash
viberoots gc
```

Preview mode:

```bash
viberoots gc --dry-run
```

More aggressive mode:

```bash
viberoots gc --aggressive
```

Optional optimizations remain opt-in:

```bash
viberoots gc --optimize
```

`gc` is a convenience wrapper for `vbr gc` and should stay available from any directory inside the consumer workspace. The wrapper may grow to orchestrate additional GC commands later, but default `gc` should do useful full maintenance instead of silently skipping Nix cleanup. Pass `--no-nix` to limit a run to local generated-state cleanup.

Default `viberoots gc` is safe maintenance. `--aggressive` expands local generated-state cleanup
after stronger active-work checks. `--optimize` is a separate opt-in for slower cleanup-adjacent
optimizations. Initially, that means Nix store deduplication, but the generic flag leaves room for
future safe optimizations without adding another public option.

This aligns with existing verify guardrails that treat Nix store optimization as opt-in rather than
automatic.

### Cleanup Categories

#### Nix Store Cleanup

Default Nix cleanup should use modern Nix commands when available:

```bash
nix store gc
```

If the installed Nix does not support `nix store gc`, fall back to:

```bash
nix-collect-garbage
```

Optional age policy:

```bash
viberoots gc --nix-delete-older-than 7d
```

Implementation mapping:

- Prefer `nix-collect-garbage --delete-older-than <age>` when an age policy is requested. That command deletes old profile generations before collecting unreachable store paths.
- Use `nix store gc` for default store garbage collection when no age policy is requested.
- If `nix-collect-garbage` is unavailable but `nix` is available, fall back to `nix profile wipe-history --older-than <age>` for the current profile before `nix store gc`.

Do not run `nix-collect-garbage -d` by default. Deleting all old generations can be surprising and broader than a repo maintenance command should be.

#### Optional Optimizations

The first `--optimize` behavior should be Nix store deduplication with `nix store optimise` or
`nix-store --optimise`. This can be expensive and disruptive during active work, so keep it opt-in:

```bash
viberoots gc --optimize
```

The command should print the concrete optimization plan before running it:

```text
nix store optimization is opt-in and may take a while
```

Future optimizations may be added behind the same `--optimize` flag only when they are:

- safe to run after the normal `gc` plan;
- previewed by `viberoots gc --dry-run --optimize`;
- covered by tests;
- documented in this section and command help.

Do not combine any optimization with normal cleanup unless explicitly requested.

#### viberoots Generated Workspace State

Safe default cleanup candidates:

| Path                                                                   | Default                   | Reason                                                                         |
| ---------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `.viberoots/workspace/buck/tmp/`                                       | remove stale entries only | Generated Buck workspace temp state.                                           |
| `.viberoots/buck/tmp/`                                                 | remove stale entries only | Generated viberoots Buck temp state.                                           |
| `buck-out/tmp/shared-isolation-locks/`                                 | remove stale entries only | Verify/dev-build lock scratch state.                                           |
| stale owner-encoded verify/dev-build isolation roots under `buck-out/` | remove stale entries only | Existing verify cleanup policy already treats stale owned roots as disposable. |
| `.viberoots/workspace/backups/`                                        | keep by default           | May contain user file backups from bootstrap repair.                           |
| `.viberoots/bootstrap/transactions/completed/`                         | keep newest N, prune old  | Audit trail; safe to bound.                                                    |

Default cleanup should use age and ownership checks rather than broad deletion.

Suggested defaults:

- Remove entries older than 24 hours for temp directories.
- Keep the newest 20 completed bootstrap/source-mode transactions.
- Remove interrupted transaction only if `ownerPid` is not alive and `--aggressive` is set; otherwise report it and suggest `viberoots bootstrap-check --repair-if-needed`.

#### Buck Output Cleanup

Broad `buck-out` cleanup must remain conservative because recent guardrails were added to avoid killing active runs or removing unrelated user state.

Default `viberoots gc` may:

- remove viberoots-owned stale verify/dev-build isolation roots when the owner process is gone;
- remove empty directories under viberoots-owned temp roots;
- mark cleanup candidates with Spotlight exclusion metadata where applicable.

Default `viberoots gc` must not:

- remove all of `buck-out`;
- remove `buck-out/test-logs`;
- remove active verify pass output;
- kill processes;
- remove user-created files just because they are untracked.

`--aggressive` may additionally remove known regenerated local state, but only when no active `b`, `v`, Buck, Nix build, or viberoots registered-tool process is detected for this workspace.

Aggressive candidates:

| Path                                        | Aggressive behavior                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `.viberoots/cache/`                         | Remove entries older than configured age if not in use.                       |
| `.viberoots/workspace/buck/`                | Remove stale temp subtrees, never active graph files needed by current shell. |
| root `buck-out/v-*` and `buck-out/verify-*` | Remove stale owned isolation roots only.                                      |

No mode should remove `projects/config/local.json`, `.local/`, `.envrc`, `.buckconfig`, `.buckroot`, `README.md`, `projects/`, `viberoots/`, or `.git/`.

### Active Work Detection

Before local generated-state cleanup, detect active workspace work:

- Registered tool state under existing viberoots tool-state files.
- Buck daemon/process evidence for this workspace.
- Verify lock files.
- Owner PID encoded in isolation directory names or metadata.
- Active Nix GC/build processes.

Default cleanup can proceed for stale ownerless temp entries while active work exists, but it should skip anything ambiguous.

`--aggressive` should refuse while active work is detected:

```text
error: refusing aggressive gc while viberoots work is active
```

### Dry Run Output

`viberoots gc --dry-run` should print grouped planned actions:

```text
viberoots gc plan
  nix:
    - nix-collect-garbage --delete-older-than 7d
  local generated state:
    - remove .viberoots/workspace/buck/tmp/example
    - prune completed bootstrap transactions older than newest 20
  skipped:
    - buck-out/test-logs (preserved)
    - .viberoots/bootstrap/transactions/current.json (incomplete transaction; run bootstrap-check)
```

Dry run must not mutate files and must not run Nix GC.

### Result Summary

Non-dry-run output should include:

```text
viberoots gc summary
  nix cleanup: completed
  local paths removed: <count>
  bytes removed from local generated state: <best-effort bytes>
  skipped: <count>
```

Nix reports its own freed bytes; the command should preserve that output rather than trying to reinterpret it.

### Error Handling

If Nix GC fails, report the failure but still summarize local cleanup only if it already completed.

Preferred order:

1. Local generated-state dry-run/plan.
2. Nix dry-run/plan.
3. Local generated-state cleanup.
4. Nix cleanup.
5. Optional Nix optimization.

This order avoids deleting local evidence after a Nix failure and keeps the cleanup summary clear.

If a local cleanup candidate fails to remove, continue to the next candidate and report it as skipped unless the failure indicates a bug in path classification.

Path classification bugs should fail closed.

Resource graph exports under `.viberoots/workspace/resource-graph/` are local generated state. They
are removable by `viberoots gc` because `viberoots resource-graph export` can regenerate them from
reviewed Buck deployment metadata and resolved workspace inputs.

### Implementation Shape

Add a dedicated library:

```text
build-tools/tools/lib/maintenance-gc.ts
```

Suggested public API:

```ts
type GcOptions = {
  workspaceRoot: string;
  dryRun?: boolean;
  aggressive?: boolean;
  optimize?: boolean;
  nix?: boolean;
  verbose?: boolean;
  nixDeleteOlderThan?: string;
  keepCurrentProfile?: boolean;
};

type GcPlan = {
  nix: PlannedCommand[];
  local: PlannedRemoval[];
  skipped: SkippedCleanup[];
};

planViberootsGc(opts: GcOptions): Promise<GcPlan>;
runViberootsGc(opts: GcOptions): Promise<GcSummary>;
```

Keep Nix command execution injectable for tests.

Keep filesystem deletion behind a small removal helper that:

- resolves real paths;
- refuses paths outside the workspace root or Nix profile/store command scope;
- refuses source/control paths by denylist;
- records best-effort byte size before deletion;
- supports dry-run.

Add bootstrap launcher support in:

```text
build-tools/tools/lib/live-bootstrap.ts
```

Suggested API:

```ts
type LiveBootstrapOptions = {
  command: "bootstrap" | "update";
  bootstrapUrl?: string;
  trustBootstrapUrl?: boolean;
  envOverrides: Record<string, string>;
};

runLiveBootstrap(opts: LiveBootstrapOptions): Promise<void>;
```

Extend:

```text
build-tools/tools/dev/viberoots.ts
```

with metadata-driven commands and completion for `bootstrap`, `update`, and `gc`.

## Documentation Updates

Update `README.md`:

- In Quick Start, mention `viberoots bootstrap` and `viberoots update` as the installed CLI form of the curlable bootstrap.
- Keep the curl command as the first-run path for machines that do not yet have viberoots installed.
- Add a short maintenance section:

```bash
viberoots gc --dry-run
viberoots gc
```

- Mention that `viberoots gc --optimize` is opt-in and currently performs Nix store optimization.

Update `docs/viberoots-source-modes.md`:

- Link to this document from the Help and Bash Completion sections because all command metadata should include source-mode and maintenance commands.

Update `docs/handbook/troubleshooting.md`:

- Add `viberoots gc --dry-run` as the first diagnostic cleanup command for local generated-state bloat.
- Keep manual `nix store gc` guidance as lower-level fallback.

Update `docs/handbook/getting-started-on-a-pr.md`:

- Add a guardrail: do not run broad cleanup during active verify runs; use `viberoots gc --dry-run` first.
- Keep `viberoots gc --optimize` opt-in and do not document optimization as a default speed fix
  unless measured evidence supports it.

Update command help:

```bash
viberoots help bootstrap
viberoots help update
viberoots help gc
```

## Test Coverage

### Bootstrap and Update Alias Tests

- `viberoots bootstrap --dry-run` downloads or resolves the live script path and invokes it with `VBR_DRY_RUN=1`.
- `viberoots update --dry-run` produces the same launcher behavior as `bootstrap`.
- CLI flags override environment variables for the launched process.
- Default URL is GitHub main.
- Custom URL without `--trust-bootstrap-url` is refused.
- Custom URL with trust is accepted.
- Fetch failure fails closed and does not fall back to local bootstrap.
- Downloaded script validation rejects empty or obviously non-shell content.

### GC Plan Tests

- `viberoots gc --dry-run` prints Nix commands and local cleanup candidates without mutation.
- Default plan includes `nix store gc` or fallback based on mocked Nix capability.
- `--nix-delete-older-than 7d` prefers `nix-collect-garbage --delete-older-than 7d`.
- If `nix-collect-garbage` is unavailable, `--nix-delete-older-than 7d` falls back to current-profile history cleanup before store GC.
- `--optimize` adds store optimization only when explicitly requested.
- Store optimization is absent by default.
- Completed bootstrap transactions are pruned to newest N in plan.
- Current incomplete transaction is skipped with bootstrap-check remediation.
- `buck-out/test-logs` is never planned for removal.
- `.local`, `projects/config/local.json`, `.git`, `projects`, and `viberoots` are never planned for removal.

### GC Execution Tests

- Removes only planned viberoots-owned temp paths.
- Refuses path traversal and symlink escape candidates.
- Continues after a removable path disappears between plan and execution.
- Reports skipped paths and best-effort local bytes.
- Refuses `--aggressive` when mocked active work is detected.
- Allows conservative stale-temp cleanup while unrelated active work exists.

### Help and Completion Tests

- `viberoots help` lists `bootstrap`, `update`, and `gc`.
- `viberoots completion bash` includes command-specific options.
- Help and completion are generated from shared metadata.

## Open Questions

- Should `viberoots gc` default `--nix-delete-older-than` to a value such as `7d`, or should age-based profile history cleanup require an explicit flag? Conservative recommendation: no default age deletion; default runs store GC only.
- Should local temp cleanup age default be configurable through an environment variable such as `VBR_GC_LOCAL_OLDER_THAN`? Recommendation: support it later only if operators need it.
- Should `viberoots bootstrap` support `--print-url` for debugging? Recommendation: not initially; `--dry-run` can print the resolved URL.

## Recommended Initial Scope

Implement in two PR-sized slices:

1. `viberoots bootstrap` and `viberoots update` launcher aliases, help, completion, docs, and tests.
2. `viberoots gc` conservative planner/executor, help, completion, docs, and tests.

Keep `--aggressive` and `--optimize` in the first `gc` implementation only if the plan/execution
safety checks are covered by tests before landing.
