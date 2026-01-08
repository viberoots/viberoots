# Space‑saving tasks (disk growth mitigations)

This document captures the concrete changes we’ve made (and previously attempted) to keep `v` (verify) from **filling the disk** or causing runaway **Nix store growth**. The emphasis is on mitigations that reduce _growth over time_ and _per‑run spikes_, not just “run GC more often”.

The core failure mode we observed was:

- **`buck-out/` stayed small** during the incident, but
- **`/nix/store` grew rapidly (tens of GB) during `v`**, and then
- a subsequent `nix-store --gc` reclaimed almost all of it, indicating the spike was **mostly unpinned** (transient), but still disruptive because it drives the filesystem to 100% and stalls/fails builds/tests.

---

## Active mitigations (current code)

### 1) Disable raw V8 coverage output unless explicitly requested

Raw V8 coverage (`NODE_V8_COVERAGE`) can generate large per-test artifacts. We changed verify so that raw coverage is only enabled when `COVERAGE=1` (i.e. `v --coverage`), preventing silent accumulation during normal runs.

- **Where**: `tools/bin/verify` (wrapper) + `tools/dev/verify/*` (implementation)
- **What**:
  - Creates a per-run raw coverage directory under `buck-out/tmp/node-v8-coverage/v-*` only in coverage mode.
  - Cleans up stale `buck-out/tmp/node-v8-coverage/v-*` dirs when coverage is disabled (local runs only).
  - Passes `NODE_V8_COVERAGE=...` into Buck test execution only when coverage is enabled.

### 2) Preflight housekeeping + bounded Nix maintenance + hard disk gate

When disk is tight, repeated builds/tests can quickly spiral into ENOSPC and additional churn. Verify now does a preflight that cleans repo-local temp outputs, runs bounded `nix store optimise`, optionally runs bounded `nix-store --gc --max-freed …`, and then **refuses to start** if free space is still below a configurable threshold.

- **Where**: `tools/bin/verify` (wrapper) + `tools/dev/verify/housekeeping.ts` (implementation)
- **What**:
  - `tools/dev/clean-temp-outs.ts` best-effort cleanup.
  - Purges repo-local `buck-out/tmp` and `.tmp` when critically low.
  - Runs `nix store optimise` with a short timeout.
  - Runs bounded GC cycles with escalating `--max-freed`.
  - **Hard gate**: abort verify early if free space remains below `VERIFY_TARGET_FREE_GB`.

### 3) Stop per‑temp‑repo `flake.lock` rewriting that caused massive `*-source` churn

This was the big one for the “disk filled during `v`” incident.

We found that `runInTemp()` was rewriting `flake.lock` inside each temp repo to convert a relative `path` input (notably `uv2nix`) into an **absolute path under the temp directory**. That made each temp repo content-unique, so `nix build --impure path:${tmp}#...` would produce a new `*-source` store snapshot for every temp repo, rapidly filling `/nix/store`.

- **Where**: `tools/tests/lib/test-helpers.ts` (`runInTemp`)
- **What**:
  - Removed the logic that rewrote `flake.lock` `path` inputs to per-run absolute paths.
  - Added an explicit comment explaining that the rewrite causes per-temp `*-source` store churn and disk spikes.

### 4) Ensure temp repo copying avoids large/volatile directories

Keeping the temp repo minimal reduces IO and avoids pulling large artifacts into each temp run.

- **Where**: `tools/tests/lib/test-helpers.ts` (`rsyncRepoTo`)
- **What** (notable excludes):
  - `buck-out`, `.git`, `.direnv`, `result`, `node_modules`, `.pnpm-store`, `coverage`, `.clinic`, and generated provider/graph artifacts.

### 5) Canonicalize Nix workspace/flake roots to physical paths

On macOS, path aliasing (e.g. `/var` vs `/private/var`) can cause Nix to treat paths as different and/or error. We canonicalize key roots with `pwd -P`.

- **Where**: `lang/nix_shell.bzl`
- **What**:
  - Canonicalizes `WORKSPACE_ROOT` and `FLK_ROOT` to physical paths before invoking Nix.

### 6) Exclude volatile paths from Nix “repo snapshot” inputs

When Nix needs a snapshot of the repo (e.g. via `builtins.path`), including volatile dirs makes the snapshot change frequently, which increases store churn.

- **Where**: `flake.nix`
- **What**:
  - `filterRepo` excludes `buck-out/`, `coverage/`, `.clinic/`, `node_modules/`, `.pnpm/`, `.git/`, `.direnv/`, `.cache/`, etc.

### 7) Make uv2nix environment derivations depend only on the lockfile (not the full workspace)

Even after we stopped rewriting `flake.lock`, we observed runs where `/nix/store` still dropped rapidly and `*-source` totals grew by tens of GB. One major contributor was `uv2nix` env realization: when the `uv2nix` environment derivation hashes the _entire_ workspace source tree, then evaluating from temp workspaces (which differ slightly between tests) forces fresh env derivations and re-fetches many `*-source` inputs.

- **Where**: `tools/nix/uv2nix-adapter.nix`
- **What**:
  - Introduced a minimal `srcForUv2nixEnv` store snapshot containing only `${subdir}/${lockfile}`.
  - Passed `srcForUv2nixEnv` into `uv2nixLib.mkEnv` (instead of the full `src`) to stabilize env hashes when the lockfile is unchanged.

### 8) Ensure test `nix build` invocations use `--no-link` (avoid persistent `result` GC roots)

With `TMPDIR` forced into the repo (`buck-out/tmp/tmpdir`), any `nix build` call that creates an out-link (default `./result`) can end up producing GC roots under `/nix/var/nix/gcroots/auto` pointing at paths like `.../buck-out/tmp/tmpdir/.../result`. Those roots can persist and pin large closures, driving `/nix/store` usage up during or after `v`.

- **Where**: various test files under `tools/tests/**`
- **What**:
  - Normalized test `nix build` commands to include `--no-link` (and keep using `--print-out-paths` to find outputs when needed).
  - Updated the one test that relied on `./result/...` to instead read the output path from `--print-out-paths`.

---

## Verified improvements (not primarily space-saving)

The following changes were verified to improve **runtime**, **robustness**, or **observability**. They are listed here because they _help the “v experience”_ but they aren’t honest to count as direct disk-reduction measures.

### A) Reuse Buck2 daemon across zx tests (remove per-test kills)

We observed that killing the Buck2 daemon per zx test caused repeated cold starts and rebuild churn, making `v` dramatically slower.

- **Where**: `tools/buck/zx_test.bzl` + `tools/bin/verify` (and related test helpers)
- **What**:
  - Removed the `buck2 kill` behavior tied to `ZX_TEST_KILL_DAEMON`.
  - Lean on per-run `--isolation-dir` for correctness instead of per-test daemon teardown.

### B) Avoid runaway daemon/process growth during long suites (reaper + hygiene)

We rely on a “buck daemon reaper” to clean up orphaned daemons/isolation dirs created during temp-repo tests and to avoid process accumulation across a large suite.

- **Where**: `tools/tests/lib/test-helpers.ts` + `tools/tests/lib/buck-daemon-reaper.ts`
- **What**:
  - `BNX_BUCK_REAPER_STATE_FILE` is shared per verify run and temp repos register themselves instead of spawning more helpers.
  - Reaper can reclaim isolations when temp repos are deleted.

### C) Keep temp repos on the workspace filesystem (macOS path-alias robustness + easier cleanup)

On macOS, temp roots like `/var/folders/...` can alias to `/private/var/...`, and those differences can cause subtle Nix path issues. Keeping temp repos under the workspace also makes cleanup and inspection straightforward.

- **Where**: `tools/bin/verify` wrapper script
- **What**:
  - `export TEST_TMP_IN_REPO=1`
  - `export TMPDIR="$LIVE_ROOT/buck-out/tmp/tmpdir"`

### D) Keep CoW cloning available for faster temp repo copies

Clone-aware copying reduces the wall-clock cost and IO overhead of creating temp repos.

- **Where**: `tools/lib/copy-tree.ts`
- **What**:
  - `probeCopyFileCloneSupport()` uses `COPYFILE_FICLONE` (“try”), not “force”.
  - `copyFileCloneAware()` uses “try” cloning with fallback to normal copy.

### E) Make expensive `/nix/store` totals collection opt-in (avoid startup stalls)

We found that scanning large stores (e.g. `find /nix/store … | du`) can take minutes and make `v` look “hung”. We made this analysis step opt-in.

- **Where**: `tools/bin/verify` + `tools/dev/verify/safety-rails.ts`
- **What**:
  - Store totals are collected only when `VERIFY_ANALYSIS_STORE_TOTALS=1`.

### F) Per-run “safety rails” to prevent disk-full failures (auto-stop with evidence)

CI may run multiple `v` instances concurrently, so we explicitly avoided a global mutex. Instead, each run monitors `/nix/store` and stops itself if it’s about to become disruptive.

- **Where**: `tools/bin/verify` + `tools/dev/verify/safety-rails.ts`
- **What**:
  - Per-run analysis directory under `buck-out/tmp/verify-analysis/run-*`.
  - Per-run monitors that snapshot state and signal only the current run if:
    - `/nix/store` free falls below `VERIFY_LOW_SPACE_GB`, or
    - `/nix/store` free drops by more than `VERIFY_NIX_DROP_BUDGET_GB` from that run’s baseline.

### G) Improve verify progress visibility (tail-log status mode + verify-log-status)

We found it much easier to diagnose “verify is stuck” vs “verify is making progress but slow” when we can reliably summarize the current log, and continuously watch a stable status view without manually grepping giant superconsole logs.

- **Where**: `tools/bin/tail-log`, `tools/dev/verify-log-status.ts`, `tools/lib/verify-log-status/*`
- **What**:
  - `tools/bin/tail-log --status [--json] [PID]` summarizes the verify log (pass/fail/fatal/skip, remaining, elapsed, etc.).
  - `tools/bin/tail-log --status -w [SECONDS]` continuously refreshes status and automatically follows “latest” when no PID is provided.
  - `tools/bin/verify` creates stable per-run pointers so status/diagnostics can find the right log (`buck-out/tmp/verify-logs/by-pid/<pid>.log`, and `buck-out/tmp/verify-logs/latest.log`).

### H) Keep `v` under a fixed runtime budget (make lint preflight opt-in or tightly bounded)

We observed that running `pnpm lint` inside `v` can materially increase runtime (and compete with the 18-minute full-suite expectation). The effective change was to keep a **bounded** lint preflight by default (so `v` fails fast on obviously dirty formatting), and provide an explicit opt-out (`VERIFY_SKIP_LINT=1`) for cases where lint is intentionally deferred.

- **Where**: `tools/bin/verify` and related docs/tests (verify lint preflight enforcement)
- **What**:
  - Run `pnpm -s lint` behind a strict timeout (`VERIFY_LINT_TIMEOUT_SECS`, default 600s).
  - Allow skipping the preflight explicitly via `VERIFY_SKIP_LINT=1`.

---

## Previously attempted / now removed or superseded

Some mitigation ideas were tried but are not currently present in the repo (either removed during iteration or replaced by a better approach).

### 1) Verify seed store caching / pinning experiments

We explored “seed” mechanisms intended to avoid expensive repo copies and to keep required store paths from being GC’d mid-run. Related files were later deleted/removed from the current tree:

- `tools/dev/prepare-verify-seed.ts`
- `tools/nix/verify-test-seed.nix`
- `tools/nix/verify-test-seed-src.nix`
- `tools/tests/lib/verify-seed.ts`
- several `runInTemp.verify-seed.*.test.ts` test files
- `tools/tests/lib/seed-temp-repo.ts`
- `tools/tests/lib/runInTemp.seed-repo.isolation.test.ts`

The current approach relies on `rsyncRepoTo` excludes and avoiding per-temp `flake.lock` rewriting (which was a major churn source).

_Note:_ The “seed repo” replacement described as PR‑4 in `quad-alignment-42.md` (a verify-scoped Nix store seed artifact) was a _proposal_ and is assumed **not implemented** here. Nothing in the mitigations above depends on that approach; it’s best treated as a separate, optional future optimization.

---

## How to validate the mitigations (operational checklist)

When verifying that these mitigations are working, the goal is to distinguish:

- **repo-local growth** (`buck-out/`, `.tmp/`, temp dirs), vs
- **Nix store growth** (`/nix/store`), vs
- **pinned growth** (GC roots), vs
- **unpinned transient growth** (reclaimed by GC but still disruptive).

In practice, the highest-signal checks are:

- **Before/after `v`**: `df -Pk . /nix/store`
- **Pinned roots**: `nix-store --gc --print-roots` (focus on `.direnv/flake-profile-*`, `.devenv/gc/shell-*`, and `result`)
- **Closure size of roots**: `nix path-info --closure-size --human-readable <store-path>`

---

## Files touched (high-level)

- `tools/bin/verify`: coverage gating, housekeeping, disk gate.
- `tools/dev/verify/*`: verify implementation (coverage gating, housekeeping/disk gate, workspace temp roots, safety rails).
- `tools/bin/tail-log`: status/watch mode for verify runs and better log selection behavior.
- `tools/dev/verify-log-status.ts` + `tools/lib/verify-log-status/*`: log parsing/formatting for `tail-log --status`.
- `tools/tests/lib/test-helpers.ts`: temp repo rsync excludes and removal of per-temp `flake.lock` rewriting.
- `lang/nix_shell.bzl`: canonicalize roots via physical paths (`pwd -P`) to avoid path-alias issues.
- `flake.nix`: filter repo snapshots to avoid volatile paths that create churny `*-source` store paths.
- `tools/nix/uv2nix-adapter.nix`: reduce uv2nix env churn by hashing only the lockfile subset for env realization.

---

## PR plan (how we’d ship/land this work in focused chunks)

This section lays out a clean PR breakdown for the mitigations above, using the same structure as `quad-alignment-42.md`. Each PR includes the tests and documentation needed for the change (no PRs dedicated solely to tests or docs).

The intent of this PR plan is **replayability**: it should include _all_ work identified in this document (including work that may currently exist only as uncommitted local changes), so it can be used as a checklist during a future rewrite after reverting local changes.

_Important:_ The PR numbering in this section is **local to this document** and does _not_ correspond to the PR numbering in the `quad-alignment-*.md` series.

### Coverage map (every item in this doc → a PR)

- **Active mitigations**
  - **(1) Coverage gating (`NODE_V8_COVERAGE` only when `COVERAGE=1`)** → PR-3
  - **(2) Housekeeping + bounded Nix maintenance + disk gate** → PR-3
  - **(3) Stop per-temp `flake.lock` rewriting** → PR-1
  - **(4) Temp repo copying excludes** → PR-1
  - **(5) Canonicalize Nix roots to physical paths** → PR-1
  - **(6) Filter repo snapshots to exclude volatile paths** → PR-1
  - **(7) uv2nix env depends only on lockfile subset** → PR-1
  - **(8) `nix build --no-link` everywhere in tests** → PR-2
- **Verified improvements (not primarily space-saving)**
  - **(A) Reuse Buck2 daemon across zx tests (remove per-test kills)** → PR-4
  - **(B) Reaper + per-run reaper state file (`BNX_BUCK_REAPER_STATE_FILE`)** → PR-4
  - **(C) Workspace-local temp repos (`TEST_TMP_IN_REPO`, `TMPDIR=.../buck-out/tmp/tmpdir`)** → PR-3
  - **(D) CoW clone-aware copying** → PR-4
  - **(E) Opt-in `/nix/store` totals collection (`VERIFY_ANALYSIS_STORE_TOTALS=1`)** → PR-3
  - **(F) Per-run safety rails (low-space + drop-budget, no mutex)** → PR-3
  - **(G) Verify progress visibility (tail-log status/watch + verify-log-status)** → PR-3
  - **(H) Keep `v` under a fixed runtime budget (lint preflight opt-in or bounded)** → PR-3
  - **(I) Close remaining enforcement gaps (behavioral verify tests + file-size compliance + CLI parsing hygiene)** → PR-5

### PR-1: Eliminate per-test Nix store churn from temp repos (flake inputs + uv2nix + repo snapshots)

#### Description

The highest-impact disk spikes we observed during `v` were driven by per-test evaluation/builds producing new `*-source` store paths. The primary root cause was **per-temp-repo content uniqueness** (notably via `flake.lock` rewriting). A secondary contributor was **env derivations hashing too much source** (uv2nix), and overly-broad repo snapshot inputs.

This PR ensures that evaluating/building from temp repos does not accidentally make each test “unique” from Nix’s perspective when the relevant inputs haven’t changed.

#### Scope & Changes

- `tools/tests/lib/test-helpers.ts`:
  - Remove per-temp `flake.lock` rewriting to absolute `path` inputs (keep lockfile inputs stable across temp repos).
  - Keep/extend `rsyncRepoTo` excludes so temp repos do not pull in large/volatile dirs that can perturb snapshots.
- `tools/nix/uv2nix-adapter.nix`:
  - Make uv2nix env derivations depend on a **lockfile-only** `src` snapshot (instead of hashing the full workspace).
- `flake.nix`:
  - Ensure `filterRepo` excludes volatile paths (e.g. `buck-out/`, coverage, profiling, node_modules, VCS metadata) so repo snapshots do not churn.
- `lang/nix_shell.bzl`:
  - Canonicalize key roots via physical paths (`pwd -P`) to avoid macOS path-alias drift affecting Nix evaluation and store reuse.

Non-goals:

- No changes to which flake attributes exist.
- No changes to Nix feature flags / dev shell policy.

#### Tests (in this PR)

- Add/extend a focused test that proves **two temp repos created from the same workspace** do not cause new, unique store “source” snapshots due only to temp path differences:
  - Specifically guard against reintroducing absolute-path rewriting in `flake.lock`.
- Add/extend a targeted test around uv2nix env derivation inputs:
  - Changing non-lockfile workspace files must not perturb the uv2nix env derivation hash.

#### Docs (in this PR)

- Update `space-saving-tasks.md` and the test harness docs to explicitly state:
  - temp repos must not rewrite flake path inputs to per-run absolute paths
  - uv2nix env derivations must not hash the full workspace when lockfile-only is sufficient

#### Acceptance Criteria

- Running representative temp-repo tests no longer creates large per-test `*-source` churn in `/nix/store` when the lockfile is unchanged.
- Tests fail if `flake.lock` rewrite behavior is reintroduced.

#### Risks

Moderate. Some flake configurations might have been relying on the rewrite to “make things work,” even though it caused churn.

Mitigation:

- Keep relative path inputs and ensure evaluation uses `path:${tmp}` semantics correctly.
- Add the temp-repo invariants tests to prevent silent regression.

#### Consequence of Not Implementing

We remain vulnerable to `/nix/store` spikes during `v` as temp repos create content-unique flake evaluations and env builds.

#### Downsides for Implementing

Some up-front harness work and tests to lock policy, but it prevents repeated disk blowups.

#### Recommendation

Implement.

---

### PR-2: Prevent pinned `/nix/store` growth during tests (no out-links, no accidental GC roots)

#### Description

Even if store growth is transient, it becomes disruptive when it is **pinned** via GC roots (e.g., `result` out-links), preventing `nix-store --gc` from reclaiming space. We saw that `nix build` defaults can create out-links and thus auto GC roots.

This PR makes all test `nix build` usage policy-compliant and GC-root-safe by default.

#### Scope & Changes

- Normalize all `nix build` invocations in tests to:
  - use `--no-link`
  - rely on `--print-out-paths` for output discovery
- Update any tests that relied on `./result/...` to use captured out paths instead.

Non-goals:

- No changes to Nix build attributes; only command shape and output capture.

#### Tests (in this PR)

- Add an enforcement test that scans test sources touched by the PR to ensure:
  - `nix build` includes `--no-link` (or uses a shared helper that guarantees it)
  - tests do not rely on `./result` for output paths
- Add a regression test that fails if `nix-store --gc --print-roots` shows newly-created `result` roots under test temp dirs for a representative run.

#### Docs (in this PR)

- Add/update the “Nix calling in tests” policy section (docs + `space-saving-tasks.md`):
  - out-links are forbidden in tests (`--no-link` mandatory)
  - use `--print-out-paths` for output capture

#### Acceptance Criteria

- A representative `v` run does not create new persistent `result` GC roots attributable to tests.
- Tests enforce the `--no-link` policy and fail on drift.

#### Risks

Low to moderate. Some tests may have assumed `result` exists.

Mitigation:

- Update those tests mechanically to use `--print-out-paths`.

#### Consequence of Not Implementing

Disk fills remain “sticky” because pinned roots prevent GC from recovering space, even when growth would otherwise be transient.

#### Downsides for Implementing

Small call-site churn in tests and a couple enforcement tests.

#### Recommendation

Implement.

---

### PR-3: Make `v` self-defending: bounded maintenance + disk gate + per-run safety rails (no mutex)

#### Description

We want `v` to be robust in the face of transient store growth and to fail fast with evidence before the machine hits ENOSPC. We explicitly avoid any global mutex (CI may run multiple `v` instances), so each verify run must be self-contained and self-terminating under danger.

#### Scope & Changes

- `tools/bin/verify`:
  - Preflight cleanup (repo-local temp outs) and bounded Nix maintenance (`optimise`, bounded `gc`) under timeouts.
  - Disk gate: refuse to start when free space is below `VERIFY_TARGET_FREE_GB`.
  - Coverage gating: avoid raw V8 coverage output unless `COVERAGE=1`.
  - Keep temp repos on the workspace filesystem:
    - `TEST_TMP_IN_REPO=1`
    - `TMPDIR="$LIVE_ROOT/buck-out/tmp/tmpdir"`
  - Improve operator-facing diagnostics:
    - stable per-run log pointers for the current PID and “latest”
    - `tools/bin/tail-log --status [--json] [-w] [PID]` for summary + watch mode
  - Per-run safety rails:
    - stop the current run if `/nix/store` free falls below `VERIFY_LOW_SPACE_GB`
    - stop the current run if `/nix/store` free drops by more than `VERIFY_NIX_DROP_BUDGET_GB` from baseline
    - triggers capture snapshots and signal only the current process group.
  - Keep `v` under a fixed runtime budget:
    - do not run an unbounded lint preflight inside `v` (either make it opt-in, or keep it strictly time-bounded)
- `tools/dev/verify-analysis/*.sh`:
  - Per-run diagnostics scripts copied into the run directory (so concurrent runs don’t fight over shared paths):
    - `sample.sh`: periodic snapshots (e.g. `df` for repo and `/nix/store`, basic process status, and “where is verify right now” breadcrumbs).
    - `monitor.sh`: long-running loop that appends to the run’s telemetry log(s) (disk slope + “Waiting on Test …” style progress).
    - `low-space-trigger.sh`: stops _only the current verify process group_ when `/nix/store` free falls below `VERIFY_LOW_SPACE_GB`, after writing a final snapshot.
    - `drop-budget-trigger.sh`: stops _only the current verify process group_ when `/nix/store` free drops by more than `VERIFY_NIX_DROP_BUDGET_GB` from the baseline, after writing a final snapshot.
  - Ensure scripts are robust to common shell portability issues (quoting, directory creation, `date` compat).

Non-goals:

- No global locking/mutex to prevent concurrent verifications.

#### Tests (in this PR)

- Add/extend tests for verify behavior:
  - verify aborts early when free space is below thresholds (simulate via injectable `df`/telemetry helpers or controlled env hooks)
  - verify enables/disables coverage output correctly based on `COVERAGE`
  - safety-rails signaling targets only the verify run’s process group (no cross-run kill)
  - verify stages/copies the diagnostics scripts into the per-run analysis directory and they are executable
  - `tools/bin/tail-log --status` can find and summarize the correct verify log (PID mode and “latest” mode)

#### Docs (in this PR)

- Document verify safety rails and how to tune:
  - `VERIFY_TARGET_FREE_GB`, `VERIFY_LOW_SPACE_GB`, `VERIFY_NIX_DROP_BUDGET_GB`, `VERIFY_ANALYSIS_STORE_TOTALS`
- Document the diagnostics scripts and expected artifacts (what files they write, how to tail them, and what to look for when disk usage balloons).
- Document the recommended operator workflows:
  - `tools/bin/tail-log --status -w` (watch mode)
  - `tools/bin/tail-log --status --json` (machine-readable)
- Update operator checklist in `space-saving-tasks.md` with expected artifacts and how to interpret snapshots.

#### Acceptance Criteria

- `v` does not run the machine into ENOSPC without producing snapshots and a clear reason for stopping.
- Multiple concurrent `v` runs do not interfere with one another (no global lock; per-run self-termination only).

#### Risks

Moderate. Overly aggressive gates could stop valid runs; overly lax gates could still allow ENOSPC.

Mitigation:

- Conservative defaults + env overrides + clear logging.
- Tests for the “stop only me” behavior.

#### Consequence of Not Implementing

We continue to waste cycles on runs that become slow/hung and eventually fail due to disk pressure, with limited evidence.

#### Downsides for Implementing

More verify complexity and a few more knobs, but it’s localized to verify and improves safety substantially.

#### Recommendation

Implement.

---

### PR-4: Stabilize and speed up large suites (Buck2 daemon reuse + temp repo ergonomics)

#### Description

This PR focuses on verified non-space improvements that materially affect `v` runtime and reliability, which indirectly helps disk safety by reducing time spent in “churny” states.

#### Scope & Changes

- Stop killing buckd per zx test (`ZX_TEST_KILL_DAEMON` behavior removed/disabled) so caching works and tests don’t run in constant cold-start mode.
- Ensure a single reaper state file is shared per verify run (`BNX_BUCK_REAPER_STATE_FILE`), and temp repos register themselves instead of spawning per-test helpers.
- Maintain clone-aware copying as a fast path for temp repo creation.
- Keep expensive store totals collection opt-in to prevent multi-minute “startup stalls”.

#### Tests (in this PR)

- Add/extend a smoke test that runs a small zx test batch and asserts:
  - buckd is not killed between tests (detect via logs or daemon pid stability heuristics)
  - reaper state file is used and grows as temp repos are created
- Add an enforcement test to prevent reintroducing `buck2 kill` in per-test wrappers.

#### Docs (in this PR)

- Document the intended lifecycle:
  - daemon reuse policy + when/where teardown happens
  - reaper state file contract and how temp repos register

#### Acceptance Criteria

- `v` runtime is materially improved vs. per-test daemon kill behavior.
- No unbounded accumulation of buck daemons/isolation dirs across a long suite.

#### Risks

Low to moderate. If daemon reuse uncovers hidden isolation assumptions, tests could become flaky.

Mitigation:

- Keep `--isolation-dir` per verify run as the primary correctness boundary.
- Add the smoke tests and enforcement checks.

#### Consequence of Not Implementing

`v` remains slower and more fragile, increasing the likelihood we hit disk-pressure failure modes before the suite completes.

#### Downsides for Implementing

Some additional harness complexity, but it pays back in runtime and reliability.

#### Recommendation

Implement.

---

### PR-5: Close remaining enforcement gaps (behavioral verify tests + file-size compliance + CLI parsing hygiene)

#### Description

The mitigations above address the primary disk-growth failure modes, but there are still gaps that make regressions easier:

- Some verify safety behaviors are enforced by “contract string” checks, not behavioral tests.
- A few key files exceed the ≤250 line rule in `METHODOLOGY.XML`, which makes long-term maintenance harder and increases regression risk.
- A small amount of CLI parsing drift exists (minor `process.argv` checks), which conflicts with the tooling hygiene rules in `getting-started-on-a-pr.md`.

This PR closes those gaps without changing the user-facing behavior of `v` or the build system contracts.

#### Scope & Changes

- `tools/dev/verify/safety-rails.ts`:
  - Factor the “trigger decision” logic into a small exported helper with injectable side-effects (snapshot writer, `df` sampler, process-group killer) so we can test the behavior deterministically without requiring real low-disk conditions.
  - Keep default behavior unchanged for normal runs.
- `tools/dev/verify/housekeeping.ts`:
  - Add a small exported helper for disk-gate decisions so tests can validate the exact failure message and exit behavior without depending on the real filesystem’s free space.
  - Keep the public behavior and env knobs unchanged.
- `tools/tests/verify/*`:
  - Add behavioral tests for:
    - disk gate refusal logic (including message content and exit code),
    - safety rails triggers (low-space + drop-budget) proving we write a snapshot and send signals only to the intended process group.
- `tools/tests/lib/test-helpers.ts`:
  - Split the monolithic helper into small focused modules under `tools/tests/lib/test-helpers/`.
  - Keep `tools/tests/lib/test-helpers.ts` as a stable re-export surface so existing imports continue to work unchanged.
- `flake.nix`:
  - Factor the large flake into small imported modules under `tools/nix/` (e.g., snapshot filtering, package wiring, devshell wiring) so the top-level flake stays readable and within the file-size constraint.
  - Keep flake outputs and attribute names unchanged.
- `tools/dev/verify-log-status.ts`:
  - Remove any bespoke `process.argv` parsing and rely only on `tools/lib/cli.ts` helpers for flags/tokens.
- `space-saving-tasks.md`:
  - Align wording for lint preflight to match actual behavior: bounded by default with an explicit opt-out (`VERIFY_SKIP_LINT=1`).

Non-goals:

- No changes to the verify CLI surface (`v` flags and env vars stay the same).
- No changes to Nix feature flags, store policies, or the high-level build graph/exporter contracts.
- No “tune the thresholds” work; this PR is about correctness, enforcement, and maintainability.

#### Tests (in this PR)

- Verify disk gate behavioral test:
  - Proves verify refuses to start (exit code + message) when computed free space is below the configured target threshold.
- Verify safety rails behavioral tests:
  - Proves low-space trigger and drop-budget trigger both:
    - write a snapshot file under the per-run analysis directory, and
    - signal only the intended process group (no cross-run interference).
- File-size compliance enforcement (scoped to touched areas):
  - Fails if `tools/tests/lib/test-helpers.ts` and the refactored flake entrypoint exceed the 250-line limit after the split.
- CLI parsing hygiene:
  - A small test or linting check that `tools/dev/verify-log-status.ts` does not use `process.argv` directly for flag parsing.

#### Docs (in this PR)

- Update `space-saving-tasks.md` PR plan and the verify operator notes to reflect:
  - bounded lint preflight default + explicit opt-out,
  - what the new behavioral tests cover (so future refactors know what they must preserve),
  - why the file-size splits exist (maintenance + regression containment).

#### Acceptance Criteria

- Verify disk gate and safety rails have behavioral tests that fail if the logic regresses.
- `tools/tests/lib/test-helpers.ts` is ≤ 250 lines and public imports remain stable via re-exports.
- The flake entrypoint remains functionally identical but is decomposed into ≤250-line modules.
- `tools/dev/verify-log-status.ts` uses `tools/lib/cli.ts` only (no bespoke argv parsing).

#### Risks

Moderate. The file splits (especially `flake.nix`) can accidentally change evaluation wiring or output structure if not done carefully.

Mitigation:

- Keep the top-level flake outputs stable and add a small “flake outputs invariant” check (e.g., `nix flake show` output shape or a targeted `nix eval` of key attrs) in tests where practical.
- Make refactors incremental and validate with a representative local `v` run before landing.

#### Consequence of Not Implementing

- Regressions in verify safety behavior may not be caught until a real low-disk event occurs.
- Large, monolithic files remain hard to safely evolve, increasing the chance of accidental churn regressions.
- Tooling hygiene drift accumulates (argv parsing, policy inconsistencies), making future automation harder to standardize.

#### Downsides for Implementing

- Mechanical churn: splitting files and updating imports/paths while preserving behavior.
- A small increase in test surface area to lock in safety-rail behavior.

#### Recommendation

Implement.
