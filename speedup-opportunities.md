# Speedup Opportunities — `v` / zx test temp workspaces (Measured + Implementable PR Plan)

This report captures **measured** overhead from a timing-enabled full `v` run and proposes a set of focused PRs to reduce end-to-end runtime **without sacrificing determinism** or violating the project’s design philosophy (explicit inputs, no hidden fallbacks, correctness-first).

It intentionally mirrors the **PR subsection structure** used in `quad-alignment-32.md` so it can be tracked/rolled out the same way.

---

## Baseline: what we measured

### Run configuration

- **Command**: `timeout 60m env TEST_TIMING=summary ./build-tools/tools/bin/v` (inside `direnv exec .`)
- **Verify log**: `buck-out/tmp/verify-logs/verify-20251228-124519-wzMjkLZv.log`
- **Timing source**: `build-tools/tools/tests/lib/test-helpers.ts` emits `[timing] summary` for `runInTemp(...)` overhead.

### Run outcome + parallelism

- **Wall clock**: **1035s** (**17:15**) for the `buck2 test` phase
- **Tests with durations parsed**: **594**
- **Sum of per-test durations**: **6549.7s**
- **Effective parallelism**: **~6.33×** (sum_durations / wall)

### Where the time went (top redundant buckets)

These numbers are **aggregate totals across the suite** (i.e., the sum across all `runInTemp` invocations that emitted timing summaries):

| Bucket (measured)                       | Total across suite | Count | Approx avg |
| --------------------------------------- | -----------------: | ----: | ---------: |
| `rsyncRepoTo(...)`                      |        **1392.1s** |  511× |     ~2.73s |
| `zx-init probe (node --import zx-init)` |         **308.9s** |  511× |     ~0.60s |
| `toolchain probe (command -v ...)`      |          **93.5s** |  511× |     ~0.18s |
| `xcrun --show-sdk-path`                 |          **49.2s** |  511× |     ~0.10s |
| `buck-daemon-reaper setup`              |               2.3s |  511× |     ~0.00s |

### How we estimate wall-clock savings

We convert “total time spent across suite” into an **approximate wall-clock win** by dividing by the effective parallelism:

\[
\text{estimated wall savings} \approx \frac{\text{total redundant seconds}}{6.33}
\]

Important notes:

- This is an **upper-bound-ish** estimate for changes that affect work that is evenly spread across test workers.
- Actual savings can be smaller if the work is on the critical path of a few long tests, or if removing the work changes scheduling dynamics.
- For that reason, each PR below includes both:
  - a **best-case estimate** from the formula above
  - a **more realistic expected range** based on partial elimination (e.g., 50–80% reduction)

---

## PR‑1: Eliminate repeated repo copies by introducing a per-worker “seed temp repo” + fast CoW clone

### Description

The single biggest measured overhead is **copying the repo into a new temp workspace** on every `runInTemp` call (`rsyncRepoTo(...)`).

We can preserve existing correctness constraints (isolated temp workspaces; no shared mutation) while reducing IO by:

- creating a **seed temp repo** once per test worker process
- creating each test’s temp repo via **copy-on-write (CoW) clone** of the seed (fast metadata clone; mutations don’t affect the seed)

This avoids repeating expensive directory traversal + file copying work 500+ times per run.

### Scope & Changes

- **Add a seed repo cache** in `build-tools/tools/tests/lib/test-helpers.ts`:
  - module-level state:
    - `let seedRepoDir: string | null = null`
    - `let seedRepoReady: Promise<string> | null = null`
  - `async function ensureSeedRepo(): Promise<string>`:
    - creates `seedRepoDir` via `mktemp("seed-")`
    - populates it using the existing `rsyncRepoTo(seedRepoDir)` logic (same excludes, same behavior)
    - returns the seed path
- **Introduce a new fast-clone function** (still in `test-helpers.ts`):
  - `async function cloneSeedRepoTo(seed: string, dst: string, $: any): Promise<void>`
  - Implementation policy:
    - Prefer CoW clone when available (no shell `||` fallbacks; detect capability explicitly):
      - **macOS (APFS)**: use `cp -cR` if supported by `/bin/cp` (clonefile). Detect support by running `cp -c` on a tiny temp dir once and caching the result.
      - **Linux**: use `cp -a --reflink=auto` if available (GNU coreutils). Detect by parsing `cp --help` output or a tiny trial copy.
    - If CoW cloning is not supported, keep correctness by using the existing `rsyncRepoTo(dst)` path (explicit branch, not a masked fallback).
- **Update `runInTemp`**:
  - Replace the unconditional `await rsyncRepoTo(tmp)` with:
    - `const seed = await ensureSeedRepo()`
    - `await timeAsync(\`cloneSeedRepoTo(${basename(tmp)})\`, () => cloneSeedRepoTo(seed, tmp, $))`
  - Keep the rest of `runInTemp` intact (flake.lock normalization, buck config setup, workspace-root env, etc.)
- **Add a safety contract**:
  - The seed must never be mutated.
  - All per-test mutations (like flake.lock rewrite) happen in the cloned repo (safe under CoW clone).

### Tests (in this PR)

- Add a focused unit/integration test under `build-tools/tools/tests/lib/` that:
  - calls `runInTemp` twice
  - inside the first temp, writes/edits a file that also exists in the seed (e.g., `flake.lock` in temp)
  - then runs a second `runInTemp` and asserts it did **not** observe the prior mutation
  - This validates “seed isolation” (i.e., CoW clone actually isolates mutations).
- Add a timing regression test (or at minimum a benchmark-ish assertion) that:
  - runs `rsyncRepoTo(tmp)` and the new `cloneSeedRepoTo(seed, tmp)` in the same environment
  - prints both times under `TEST_TIMING=1` for local verification (avoid brittle threshold assertions in CI).

### Docs (in this PR)

- Update `docs/handbook/testing.md` (or the closest “running tests locally” doc) with:
  - what a “seed temp repo” is
  - how correctness is preserved
  - an environment toggle (if we keep it guarded initially), e.g. `TEST_USE_SEED_REPO=1`

### Acceptance Criteria

- A full `v` run with `TEST_TIMING=summary` shows:
  - `rsyncRepoTo(...)` total reduced substantially (ideally replaced by `cloneSeedRepoTo(...)`)
  - no test failures/regressions
- Seed repo is proven not to leak mutations between tests.

### Risks

- **Filesystem support**: CoW clone semantics differ by FS/platform; must be detected and validated.
- **Hidden shared mutation**: If any test mutates repo files in-place and relies on that mutation persisting, seed cloning would expose it (this is a _good_ correctness signal, but may cause churn).

### Consequence of Not Implementing

- We continue paying ~**1392s** aggregate repo-copy cost per full run.

### Downsides for Implementing

- Moderate complexity in `test-helpers.ts` (capability detection, seed lifecycle).
- Need to be careful to avoid turning this into a “silent fallback” mechanism; capability detection should be explicit and logged under timing mode.

### Recommendation

Implement (largest win, strongest evidence).

### Estimated impact

- **Best-case wall-clock win (if eliminated)**: \( 1392.1 / 6.33 \approx \) **~220s (~3m40s)**
- **Expected**:
  - If CoW clone reduces the copy cost by **50%**: **~110s (~1m50s)**
  - If CoW clone reduces the copy cost by **80%**: **~176s (~2m56s)**

---

## PR‑2: Make `zx-init` probing strictly once-per-worker (and/or removable), not per temp repo

### Description

`runInTemp` currently performs a `node --import zx-init` probe for every temp repo:

- Total measured: **308.9s** across the suite (511×)

But `build-tools/tools/tests/lib/test-helpers.ts` already imports `build-tools/tools/dev/zx-init.mjs` at module load (best-effort). The per-temp `node` subprocess is primarily a _sanity check_ that can be:

- **cached once per worker process**, or
- **removed** after we prove it’s redundant (keeping correctness by ensuring the zx wrapper environment loads zx-init reliably).

### Scope & Changes

- In `build-tools/tools/tests/lib/test-helpers.ts`:
  - Add module-level cache:
    - `let zxInitProbeDone = false`
    - `let zxInitProbePromise: Promise<void> | null = null`
  - Replace the per-temp probe with:
    - `await ensureZxInitProbedOnce(tmp, $, exportEnv)` where:
      - first call runs the current probe and sets cache
      - subsequent calls are no-ops
  - Keep timing label name stable (`zx-init probe (node --import zx-init)`) so we can measure before/after.
- Optionally (second step if proven safe):
  - remove the subprocess probe entirely and rely on:
    - the module-level import at file load
    - `NODE_OPTIONS` injection already performed in `runInTemp`

### Tests (in this PR)

- Add a unit/integration test that:
  - calls `runInTemp` twice
  - asserts the probe’s side effect happened once (e.g., by checking timing summary count is `1x` for that label when `TEST_TIMING=summary` and tests are forced to run serially in that file)
  - and that `$` is usable in both runs (basic zx global sanity).

### Docs (in this PR)

- Add a short note to `docs/handbook/testing.md`:
  - “zx-init is verified once per worker; not per temp repo”

### Acceptance Criteria

- `TEST_TIMING=summary` shows:
  - the `zx-init probe` label count collapses from ~511× to ~worker_count×
  - no regressions in zx test execution

### Risks

- If any worker process has its environment mutated mid-run in a way that breaks zx-init loading, per-temp probing would have caught it earlier. Mitigate by keeping the module-load import and retaining a way to force re-probe (e.g., `TEST_FORCE_ZX_INIT_PROBE=1`).

### Consequence of Not Implementing

- We keep paying ~**309s** aggregate for sanity checks that are almost certainly redundant.

### Downsides for Implementing

- Very small complexity; mainly about caching and a test to lock behavior down.

### Recommendation

Implement (low risk, measurable ~minute-class win).

### Estimated impact

- **Best-case wall-clock win (if eliminated)**: \( 308.9 / 6.33 \approx \) **~48.8s**
- **Expected**: **~40–50s** (because caching once-per-worker should remove the vast majority of invocations).

---

## PR‑3: Skip and cache darwin toolchain probing when `CGO_ENABLED=0` (default), and avoid per-temp `xcrun`

### Description

`runInTemp` currently does two per-temp probes:

- `xcrun --show-sdk-path` (49.2s aggregate)
- `command -v clang/clang++/xcrun/llvm-ar/ar` toolchain probing (93.5s aggregate)

But `runInTemp` also sets `CGO_ENABLED=0` by default. When CGO is off, most of this work is unnecessary; we can:

- **skip** the probes when CGO is disabled, and/or
- **cache** the results once per worker process when a test opts into CGO.

### Scope & Changes

- In `build-tools/tools/tests/lib/test-helpers.ts`:
  - Honor an explicit caller’s CGO preference:
    - If the incoming environment sets `CGO_ENABLED`, do not override it.
    - Otherwise default to `CGO_ENABLED=0` (current behavior).
  - Gate toolchain + SDK probing on “need CGO”:
    - `const needCgo = exportEnv.CGO_ENABLED === "1" || process.env.TEST_ENABLE_CGO === "1"`
    - Only run `xcrun` + toolchain probing when `needCgo` is true.
  - Cache results once per worker process:
    - `let cachedSdkPath: string | null = null`
    - `let cachedToolchain: { clang?: string; clangxx?: string; xcrun?: string; ar?: string } | null = null`
    - When `needCgo`, compute once and reuse.

### Tests (in this PR)

- Add a test that runs `runInTemp` in default mode and asserts:
  - no `xcrun` / `toolchain probe` timing labels emitted (or count stays at 0/1 depending on how we implement labels).
- Add a test that runs with `CGO_ENABLED=1` (or `TEST_ENABLE_CGO=1`) and asserts:
  - `xcrun` and toolchain probe execute at least once
  - values are exported into the temp environment (e.g., `SDKROOT` set on darwin).

### Docs (in this PR)

- Update testing docs to describe:
  - default `CGO_ENABLED=0` in temp repos
  - how to opt into CGO for specific tests

### Acceptance Criteria

- Default full `v` run shows substantial reduction in:
  - `xcrun --show-sdk-path`
  - `toolchain probe`
- No regressions in tests that require CGO (those tests must opt in explicitly).

### Risks

- Some test may implicitly rely on these env vars even when CGO is disabled. That’s a hidden dependency; if it exists, we should make it explicit (opt-in CGO / explicit env needs).

### Consequence of Not Implementing

- We keep paying ~**142.7s** aggregate for toolchain work that likely isn’t needed in the default configuration.

### Downsides for Implementing

- Small refactor; requires tightening “CGO-needed” semantics and adding opt-in for the small set of tests that truly need it.

### Recommendation

Implement (moderate reward, correctness-improving).

### Estimated impact

- **Best-case wall-clock win (if eliminated)**: \( (93.5 + 49.2) / 6.33 \approx \) **~22.5s**
- **Expected**: **~15–25s** (depending on how many tests actually need CGO/toolchains).

---

## PR‑4: Make timing analysis first-class (aggregate summary per `v` run) so decisions are data-backed

### Description

Right now, `TEST_TIMING=summary` produces per-test summaries, but aggregating across the suite requires ad-hoc parsing.

We should add a small, deterministic log analyzer so that every timing-based optimization PR can show:

- before/after totals
- estimated wall-clock impact (using the same parallelism calculation)
- deltas by bucket

This is not a speedup itself, but it prevents “optimizing blind.”

### Scope & Changes

- Add `build-tools/tools/dev/analyze-verify-timing.ts`:
  - Input: path to a verify log
  - Output:
    - wall clock from `[verify] buck2 test begin ... start_s=` / `... end_s=`
    - effective parallelism from parsed test durations
    - aggregated totals per `[timing]` bucket
    - computed estimated wall-clock savings for each bucket (and optionally deltas between two logs)
- Update `build-tools/tools/bin/verify`:
  - When `TEST_TIMING=summary` is set:
    - run the analyzer at the end and print a short aggregated report into the verify log (and/or stderr).

### Tests (in this PR)

- Add a unit test that feeds a tiny fixture log into the analyzer and asserts:
  - correct bucket aggregation
  - correct parallelism calculation
  - stable output format (so humans can diff PR-to-PR)

### Docs (in this PR)

- Update testing docs with:
  - how to run `v` with `TEST_TIMING=summary`
  - how to interpret the aggregated output

### Acceptance Criteria

- `v` + `TEST_TIMING=summary` produces an end-of-run section summarizing:
  - effective parallelism
  - top timing buckets
  - computed wall-clock estimates

### Risks

- Low. Pure analysis; does not affect test behavior.

### Consequence of Not Implementing

- Speed work remains ad-hoc and harder to validate/review.

### Downsides for Implementing

- Small additional code surface and a fixture test.

### Recommendation

Implement (enables disciplined follow-ups).

### Estimated impact

- **Runtime win**: **~0s** (analysis only), but reduces iteration time by making measurement repeatable.

---

## Summary: expected wins (based on this run’s measurements)

If we implement the top three speedups:

- **PR‑1 (seed + CoW clone)**: **~110–176s** likely (up to **~220s** best-case)
- **PR‑2 (zx-init probe once)**: **~40–50s**
- **PR‑3 (skip/cache toolchain probes)**: **~15–25s**

That’s a realistic total of **~165–251s shaved** (**~2m45s to ~4m10s**) on a run like this, while keeping correctness intact.
