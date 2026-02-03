## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 17

This installment follows Part 16. It turns the remaining cross-language leaks and glue-layer duplication into a small set of focused PRs.

The intent is to keep the shared seams stable:

- Labeling and normalization contracts stay identical across TS, Starlark, and Nix.
- “Importer-scoped ecosystems” behave consistently (Node + Python).
- Glue orchestration is centralized so callsites cannot drift.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Unify importer-scoped lockfile label attachment policy across Node and Python (exporter behavior)

### Description

Today, Python targets can receive an importer-scoped lockfile label from the exporter when macros did not stamp one, while Node relies on macros by default and only attaches labels in an env-gated experimental mode.

This is a leak because “importer wiring is label-driven” is a shared contract, but the source of truth differs by language.

### Scope & Changes

This PR will standardize the policy to: **exporter attaches missing importer-scoped lockfile labels deterministically for importer-scoped ecosystems, and macros still enforce correctness when the label is supplied explicitly.**

The work is:

- Add a shared helper in `tools/lib/importers.ts` analogous to `findNearestUvLockForPackage(...)`, for PNPM:
  - `findNearestPnpmLockForPackage(pkgDir: string): Promise<string | null>`
  - Behavior: walk upward from a Buck package directory to repo root and return the first `pnpm-lock.yaml` found, as a repo-relative POSIX path.
- Update `tools/buck/exporter/lang/node.ts` to attach a `lockfile:<pnpm-lock.yaml path>#<importer>` label when:
  - the node is classified as Node (existing `isNodeTarget` rule)
  - there is no existing `lockfile:` label
  - a pnpm lockfile is discoverable via `findNearestPnpmLockForPackage(...)`
  - importer is derived via `computeImporterLabel(lockRel)` (same rule used by Python for uv.lock).
- Remove or deprecate the env-gated “attach” mode (`EXPORTER_NODE_ATTACH`) if it becomes redundant under the new deterministic attach.
- Keep validation behavior: Node adapter still warns on malformed labels and enforces “exactly one” when the label exists on macro-stamped nodes.

This PR intentionally does not change the Starlark `require_single_importer_lockfile_label(...)` contract. It only ensures targets are more likely to have a correct label before downstream tooling runs.

### Tests (in this PR)

This PR should include tests that lock down both behavior and non-behavior changes:

- Add a focused unit test for `findNearestPnpmLockForPackage(...)` in `tools/tests/lib/` using the existing temp repo helpers. It should cover:
  - lockfile in same package dir
  - lockfile in ancestor dir
  - none found returns null
- Extend or add an exporter adapter test that:
  - constructs a minimal Node-like graph node without `lockfile:` label
  - places a synthetic `pnpm-lock.yaml` in the expected location in a temp workspace
  - asserts the Node adapter attaches exactly one `lockfile:<path>#<importer>` label
  - asserts labels are stable-sorted.
- Add a regression test to prove Python behavior is unchanged (still attaches via uv.lock search).

### Docs (in this PR)

Update the macro handbook documentation to describe the unified behavior:

- Document that the exporter may attach importer-scoped lockfile labels for Node and Python when absent, based on nearest lockfile discovery.
- Document that macros still require exactly one importer-scoped lockfile label when explicitly provided via macro parameters.

### Acceptance Criteria

- Node and Python targets that are missing `lockfile:` labels receive a deterministic label via exporter attachment when a lockfile exists.
- No target receives multiple lockfile labels due to exporter attachment.
- Existing macro-stamped targets and their error text behavior remain unchanged.

### Risks

- If any repo sections intentionally keep lockfiles only at root, importer derivation (`.`) must remain consistent with provider naming and macro expectations.
- If there are unusual workspace layouts (non `apps/*` or `libs/*` importers), auto-attachment could create labels for targets that previously had none. This must not change build behavior beyond glue mapping.

### Consequence of Not Implementing

- Node and Python will continue to differ in where lockfile labels come from, and future contract tightening will likely require duplicate changes.

### Downsides for Implementing

- Small additional logic in the Node exporter adapter and one shared helper.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `tools/lib/importers.ts`, `tools/buck/exporter/lang/node.ts`, and a narrow test. Safe in slices that already include the exporter tooling.

---

## PR‑2: Centralize “run Node with zx-init and stable flags” into one shared helper (remove duplication)

### Description

We currently have multiple ad-hoc implementations of “run Node with zx-init and the required flags” across glue scripts. This is duplication and a drift trap, because different callsites can accidentally diverge on flags, error handling, and working-directory semantics.

### Scope & Changes

Introduce a single helper under `tools/lib/` to run Node scripts consistently:

- Add `tools/lib/node-run.ts` (name can vary but should be stable and discoverable) that exports something like:
  - `runNodeWithZx({ script, args, cwd, env, zxInitPath, nodeBin }): Promise<void>`
  - It should use a single canonical flag set (the repo’s current defaults) and inherit stdio.
- Refactor callsites to use it:
  - `tools/buck/glue-pipeline.ts` (replace local `runNodeWithZx`)
  - `tools/patch/glue.ts` (replace `runNode(...)`)
  - `tools/buck/sync-providers.ts` (replace direct `node ... gen-auto-map.ts` spawn where applicable)
- Keep the public CLI behavior unchanged (same scripts, same flags, same exit behavior).

### Tests (in this PR)

- Add a unit test for the helper that runs a trivial script (or `node -e`) through the helper and asserts:
  - zx-init is loaded (can rely on an existing “zx-init-loaded” sentinel used in other tests)
  - arguments are forwarded
  - failure exit codes propagate.
- Update any tests that assert exact command prefixes so they match the consolidated helper output (without changing semantic expectations).

### Docs (in this PR)

- Update the tooling docs (handbook or `build-tools/docs/build-system-design.md` appendix section) to state:
  - glue scripts must not hand-roll node invocation flags
  - the canonical entrypoint is the new helper.

### Acceptance Criteria

- There is one canonical helper for node+zx invocation.
- All glue and patching callsites use it.
- No behavior change beyond refactoring; existing tests pass with only expected fixture updates.

### Risks

- Some tests may assert exact command-line strings. Those tests should be updated to assert semantic equivalence rather than exact formatting when possible.

### Consequence of Not Implementing

- Glue callsites will continue to drift and create hard-to-debug environment mismatches.

### Downsides for Implementing

- Mechanical refactor across a few tooling scripts plus small test adjustments.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `tools/lib/*` and a few scripts in `tools/buck` and `tools/patch`, plus tests. Safe for thin slices that include tooling.

---

## PR‑3: Remove glue pipeline drift by routing `sync-providers` “regen auto_map/index” through the centralized glue pipeline

### Description

`tools/buck/glue-pipeline.ts` is intended to be the centralized orchestration for:

- ensuring `tools/buck/graph.json`
- syncing providers
- generating provider index
- generating `auto_map.bzl`

However, `tools/buck/sync-providers.ts` currently contains its own logic to shell out to `gen-auto-map.ts` and optionally generate provider index when `--lang` is passed. This duplicates orchestration and can drift from `glue-pipeline`.

### Scope & Changes

- Refactor `tools/buck/sync-providers.ts` so that when it needs downstream glue regeneration, it calls `runGluePipeline(...)` (or a new small shared “post-sync glue” helper), rather than spawning `node ... gen-auto-map.ts` directly.
- Preserve the CLI contract:
  - `--lang` continues to narrow which provider generator runs
  - optional `--emit-index` continues to be supported
  - the resulting outputs are unchanged.

### Tests (in this PR)

- Add a test that runs `sync-providers.ts --lang node` in a temp repo and asserts:
  - `tools/buck/graph.json` exists afterward
  - `third_party/providers/auto_map.bzl` exists afterward
  - provider index is generated when requested.
- Ensure the test does not require real lockfiles by using the existing “metadata-only provider” behavior where appropriate.

### Docs (in this PR)

- Update docs for provider sync to explicitly point to the glue pipeline as the only orchestrator.
- Document the CLI behavior for `sync-providers.ts` in terms of “calls provider generators” and “delegates glue generation to the centralized pipeline.”

### Acceptance Criteria

- No callsite shells out to `gen-auto-map.ts` directly for normal flows; they delegate to the centralized pipeline.
- Outputs are unchanged, and the existing prebuild guard continues to work without modifications.

### Risks

- If any external script relies on the timing/order of the old `sync-providers` internal steps, this could surface. The regression test should lock down outputs and order-dependent behaviors.

### Consequence of Not Implementing

- Two orchestration paths remain, increasing the chance of future drift.

### Downsides for Implementing

- Small refactor in one script plus one regression test.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `tools/buck/sync-providers.ts` and tests only. Safe in very thin tooling slices.

---

## PR‑4: Clean up `ensureGraph()` implementation and lock down behavior with a focused regression test

### Description

`tools/patch/glue.ts:ensureGraph()` is a core reliability boundary. It currently contains dead/garbled code in the “target presence” check path, which is a maintenance hazard and can lead to accidental behavioral changes during future edits.

### Scope & Changes

- Remove the dead/garbled code block in `ensureGraph()` and replace it with a straightforward implementation:
  - If `BUCK_TARGET` is set and the existing graph does not include it (after normalization), regenerate.
  - Otherwise, keep the existing graph.
- Keep fallback behavior intact:
  - prefer normal exporter when buck2 is present
  - fall back to nix-run exporter
  - last resort: inline exporter via buck2 if available.

### Tests (in this PR)

- Add a regression test that:
  - writes a minimal `tools/buck/graph.json` missing a requested `BUCK_TARGET`
  - sets `BUCK_TARGET` in env
  - runs `ensureGraph()` with a stubbed exporter (or uses inline export in a temp workspace with a small TARGETS setup)
  - asserts the graph is regenerated and contains the target.
- Add a second regression case where the graph already contains the requested target, and ensure it is not regenerated (can check mtime stability or use a sentinel output).

### Docs (in this PR)

- Update the patching/glue documentation to state the `BUCK_TARGET` behavior:
  - when set, `ensureGraph()` ensures the exported graph contains the requested target.

### Acceptance Criteria

- `ensureGraph()` is free of dead code and has a simple, auditable contract.
- Target-presence behavior is covered by a regression test.

### Risks

- If any flows rely on the accidental behavior of the dead code path, this could surface. The tests should reflect the intended contract, not prior incidental behavior.

### Consequence of Not Implementing

- A core glue path remains fragile and harder to modify safely.

### Downsides for Implementing

- Small refactor plus one or two regression tests.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches a single tooling file plus narrow tests.

---

## PR‑5: Remove unused legacy C++ provider-sync code paths (keep explicit no-op behavior)

### Description

C++ provider sync is intentionally a no-op, but `tools/buck/providers/cpp.ts` still contains substantial unused logic related to curated provider scanning and patch listing. Keeping unused code here is confusing and makes it easier for future edits to accidentally reintroduce provider sync behavior.

### Scope & Changes

- Delete unused logic from `tools/buck/providers/cpp.ts` that is not referenced by any exported function or other module.
- Keep the explicit no-op messaging and contract intact:
  - provider sync registry remains a no-op for C++ (`tools/buck/providers/index.ts`).
- If any of the helper functions are used indirectly (e.g., by tests), replace those tests with ones that assert the no-op behavior directly, rather than relying on unused implementation details.

### Tests (in this PR)

- Add or update a small test that:
  - runs provider sync with `--lang cpp`
  - asserts it exits 0 and does not create/modify provider files beyond the expected stable headers (if any).
- Ensure TypeScript compilation/tests continue to pass without importing removed symbols.

### Docs (in this PR)

- Update the provider sync docs to state clearly:
  - C++ provider sync is a no-op by design, and C++ patch invalidation is package-local via `patches/cpp` included in `srcs`.

### Acceptance Criteria

- `tools/buck/providers/cpp.ts` contains only what is needed for the no-op contract.
- No other code path depends on removed helpers.

### Risks

- If any tooling had started to depend on the unused helpers implicitly, this will surface quickly via build/test failures.

### Consequence of Not Implementing

- Unused code remains a drift vector and makes it harder to reason about the intended contract.

### Downsides for Implementing

- Small deletion plus one targeted test adjustment.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `tools/buck/providers/cpp.ts` and one test. Safe in thin tooling slices.

---

## PR‑6: Make Node vs Python “patch inclusion semantics” explicit and tested (provider layer policy)

### Description

Node and Python intentionally differ in provider semantics:

- Node includes all importer-local patches as provider inputs (even if not referenced in the lockfile effective set).
- Python filters patches by the effective set derived from `uv.lock`.

This difference is reasonable, but it is easy to forget. Without a test and a short contract write-up, it becomes an abstraction leak when people assume both ecosystems behave identically.

### Scope & Changes

- Add a short, explicit contract comment in the provider sync driver callsites (`tools/buck/providers/node.ts` and `tools/buck/providers/python.ts`) explaining the policy and its intended invalidation effect.
- Add or extend a shared documentation section (handbook or `build-tools/docs/build-system-design.md`) describing:
  - why Node is “include-all importer patches”
  - why Python is “filter by effective set”
  - what users should expect when adding a patch file.

This PR should not change behavior unless we explicitly decide to unify semantics. The goal is to make the existing policy durable.

### Tests (in this PR)

- Add a regression test for Node provider sync that:
  - creates an importer with a lockfile (or a minimal parseable lockfile)
  - adds an importer-local patch that is not referenced by the effective set
  - asserts the provider rule still includes the patch input (because Node includes all).
- Add a regression test for Python provider sync that:
  - creates an importer with `uv.lock` and two patches, only one in the effective set
  - asserts only the effective patch is included in the provider rule when `strict=false` behavior is unchanged.

### Docs (in this PR)

- Document the policy in the macro/provider handbook and link to the tests as the canonical behavior reference.

### Acceptance Criteria

- The semantic difference is explicitly documented and enforced by tests.
- No behavior changes unless explicitly called out in the PR.

### Risks

- Writing reliable “minimal lockfile” fixtures can be finicky. Prefer reusing existing lockfile parsing helpers and minimal valid examples already used in tests.

### Consequence of Not Implementing

- Future contributors will treat the difference as accidental and may “fix” it inconsistently, creating drift and surprising rebuild scopes.

### Downsides for Implementing

- Two small regression tests plus a short documentation section.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `tools/buck/providers/{node,python}.ts`, a doc file, and narrow tests. Safe in tooling-focused slices.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and blast radius:

1. PR‑2 (central node-run helper) should land first. It reduces drift risk before we change behavior in more places.
2. PR‑3 (route `sync-providers` glue regen through the centralized pipeline) builds on PR‑2 and removes a second orchestration path.
3. PR‑4 (`ensureGraph` cleanup + tests) is independent and can land in parallel, but it touches a core path, so it is better to land after PR‑2 to reduce churn.
4. PR‑1 (unified importer-scoped lockfile label attachment) should land after the glue runner stabilization so any new exporter behavior is easy to test and debug.
5. PR‑5 (remove unused C++ provider-sync code) can land at any time; it is low risk and reduces confusion.
6. PR‑6 (document/test provider semantics differences) can land at any time; it is safest to land after PR‑1 so labeling behavior is stable.

---

## Verification & Backout Strategy

Each PR should include:

- A focused test that fails if the new or tightened contract regresses.
- A callsite regression test whenever the change affects how real targets are wired.
- A small documentation update that states the contract in “what happens” terms, not in abstractions.

Backout strategy:

- Each PR is independently revertible.
- If a regression is discovered:
  - revert the PR and its tests/docs together
  - keep any new tests only if they still reproduce the issue on the previous baseline and remain meaningful.
