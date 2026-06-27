# Generated Workspace Lock Repair

## Context

Consumer workspaces use generated viberoots state under `.viberoots/`. In local development, the generated workspace flake is commonly evaluated with a local `viberoots` path override so changes to the checked-out viberoots source are visible immediately.

When `.viberoots/workspace/flake.lock` still records an older local `viberoots` path input identity, repeated install/build commands can print the same warning many times:

```text
warning: not writing modified lock file of flake 'path:.../.viberoots/workspace':
• Updated input 'viberoots':
    ...
```

This happens because commands such as `i`, `b`, and graph materialization intentionally run Nix with `--no-write-lock-file`. Each command notices the stale generated lock, reports the update it would make, and then refuses to persist it.

The repeated warning is noisy, and it also points to stale generated state. Since `.viberoots/` is generated/self-healing state, `i` is the right place to repair this narrowly before dependency installation begins.

## Goals

- Remove repeated `Updated input 'viberoots'` warning spam during normal `i && b && v` flows.
- Keep build/test commands non-mutating by default.
- Avoid broad lock updates, remote input drift, and cache churn.
- Preserve a clear explanation before any repair step that may pause for more than a few seconds.
- Make repair behavior easy to disable for debugging.

## Non-Goals

- Do not run broad `nix flake update`.
- Do not update `nixpkgs`, remote inputs, or any input other than the generated workspace `viberoots` input.
- Do not repair locks from `b`, `v`, graph materialization, or test execution.
- Do not mutate committed source files.

## Proposed Behavior

At the start of `i`, after resolving the workspace root and before dependency installation work, run a generated workspace lock preflight:

1. Locate `.viberoots/workspace/flake.lock`.
2. Determine whether the workspace is using a local `viberoots` source path.
3. Parse the generated lock and inspect only the `viberoots` input node.
4. If the `viberoots` node is fresh, do nothing.
5. If the `viberoots` node is demonstrably stale, repair only that input.
6. If the state is ambiguous, skip repair by default and emit details only in verbose mode.

The repair should print one concise line before running any Nix command:

```text
[install-deps] refreshing generated workspace viberoots lock input
```

`i --dry-run` should not mutate anything. It should report whether repair would be attempted.

## Safety Guardrails

### Narrow Detection

The detector should only classify the lock as stale when all of the following are true:

- `.viberoots/workspace/flake.lock` exists.
- The generated workspace flake uses or is overridden to a local `viberoots` path.
- The lock has an identifiable `viberoots` input node.
- The lock node identity differs from the current local source identity in a way Nix would repair.

If any condition is unclear, skip repair.

### Targeted Repair Only

The repair command must update only the generated workspace `viberoots` input. It must not refresh unrelated inputs.

The implementation should prefer a targeted Nix command equivalent to updating only `viberoots` for the generated workspace flake. It must not call an unqualified `nix flake update`.

### Before/After Validation

Before repair:

- Read and keep the original generated lock contents.
- Record the parsed lock structure.

After repair:

- Parse the new generated lock.
- Verify that only the `viberoots` input node changed.
- Verify that no remote inputs changed.
- Verify that no source-controlled files changed.

If validation fails, restore the original generated lock and fail closed with a concise error.

### Atomic Backup and Restore

Because Nix writes lock files itself, the repair should create a backup copy before invoking Nix:

```text
.viberoots/workspace/flake.lock.vbr-repair.<pid>.<timestamp>.bak
```

If validation succeeds, remove the backup. If validation fails or the command is interrupted, restore the original lock where possible and leave a clear diagnostic.

### Serialization

Run repair under the existing install lock. This prevents concurrent `i` processes from attempting overlapping repairs.

Build/test commands should continue to use `--no-write-lock-file` and should not attempt repair.

### Escape Hatches

Support:

```bash
VBR_SKIP_WORKSPACE_LOCK_REPAIR=1
```

When set, `i` skips this preflight entirely.

Verbose diagnostics should be gated behind existing install verbosity, not printed during normal successful runs.

## Cache-Safety Rules

This feature must not cause significant test run slowdowns or broad cache misses.

The hot path must be cheap:

- Parse local JSON and compare known fields first.
- Do not run Nix when the generated lock is already fresh.
- Do not touch the lock file on a fresh no-op.

The repair path must be rare and narrow:

- It may run a Nix lock repair command only when stale generated state is proven.
- It must prove that only the `viberoots` input changed.
- It must log the repair once so a cache-impacting event is visible.

If a future implementation cannot prove that only `viberoots` changed, it must restore the original lock and stop.

## Interaction With Existing Commands

### `i`

`i` owns this repair because it already performs dependency and generated-state self-healing.

Expected normal output when repair is needed:

```text
[install-deps] refreshing generated workspace viberoots lock input
```

Expected normal output when no repair is needed:

No output.

### `b` and `v`

`b` and `v` should not repair generated workspace locks. They should keep `--no-write-lock-file`.

If they still print repeated stale-lock warnings after a successful `i`, that is evidence the repair did not work or did not cover the current stale shape.

### Tests

Tests that invoke `i` can set `VBR_SKIP_WORKSPACE_LOCK_REPAIR=1` when they need to preserve a fixture’s generated lock state.

## Test Plan

Add focused tests for the detector and repair wrapper:

- Fresh generated workspace lock is a no-op and does not invoke Nix.
- Stale generated `viberoots` input is detected.
- Stale generated `viberoots` input is repaired when not in dry-run mode.
- `i --dry-run` reports the intended repair without writing the lock.
- `VBR_SKIP_WORKSPACE_LOCK_REPAIR=1` skips detection and repair.
- Ambiguous or malformed lock is skipped without mutation.
- Repair refuses or restores if any input other than `viberoots` changes.
- Repair refuses or restores if a remote input changes.
- Repair runs under the install lock.
- Build/test command paths do not call the repair helper.

Add one integration-style test with a generated fixture lock that would otherwise produce repeated `Updated input 'viberoots'` warnings, then verify that the repair removes the stale condition.

## Implementation Sketch

Add a small helper module:

```text
build-tools/tools/lib/workspace-lock-repair.ts
```

Suggested API:

```ts
type WorkspaceLockRepairOptions = {
  workspaceRoot: string;
  dryRun?: boolean;
  verbose?: boolean;
  skip?: boolean;
};

type WorkspaceLockRepairResult =
  | { status: "fresh" }
  | { status: "skipped"; reason: string }
  | { status: "would-repair"; reason: string }
  | { status: "repaired"; changedInput: "viberoots" };
```

Wire it into `build-tools/tools/dev/install/deps-main.ts` after workspace root resolution and under the install lock.

## Open Questions

- What exact Nix command should be used for the targeted repair with the current installed Nix versions?
- Which lock fields are stable enough to use for stale detection across Determinate Nix versions?
- Should a failed repair be fatal, or should `i` warn and continue with compact output?

Recommendation: failed validation after a repair attempt should be fatal, because continuing after an unexpected lock mutation risks cache churn and confusing test behavior. Ambiguous pre-repair detection should be non-fatal and skip repair.
