## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 22

This installment follows Part 21. Part 21’s PR list largely reflects what is already present in the repository today (supported importer filtering in TS tooling, explicit patch inclusion policy enum, and Starlark-side supported importer validation).

This part focuses on the remaining contract gaps that I observed in the real code paths:

- Exporter lockfile label attachment can create importer-scoped labels that Starlark macros will reject.
- Node provider sync includes a “synthetic lockfile” mode that is real behavior but not an explicit contract boundary.
- Go exporter module labeling relies on an implicit global cache and an optional `fs-extra` fallback.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Close the supported-importer gap in exporter lockfile label attachment (do not auto-attach unsupported importers)

### Description

The exporter has a convenience behavior for importer-scoped ecosystems: for targets that appear macro-stamped (they have `kind:*`), it can attach a missing `lockfile:<path>#<importer>` label by searching for the nearest lockfile.

Today, this attachment path does not enforce the supported importer policy. If the nearest lockfile is under an unsupported root (not `apps/*`, not `libs/*`, not `.`), the exporter can attach a label whose importer is unsupported. That label is syntactically valid, but it violates the macro contract in `lang/lockfile_labels.bzl` and can fail later during macro evaluation with confusing causality.

This PR makes “supported importer roots” a contract in the exporter lockfile-label attachment path. The exporter must not generate labels that the macro layer will reject.

### Scope & Changes

This PR changes exporter logic and validation only. It does not change provider generation policies.

- Update `tools/buck/exporter/lang/importer-lockfile-labels.ts` to:
  - validate that `computeImporterLabel(lockRel)` is a supported importer label
  - skip auto-attaching the label when the importer is unsupported
  - emit a deterministic exporter finding that points at the unsupported importer and the lockfile path
- Update Node and Python exporter adapters to surface the finding as part of their validation when:
  - a target has `kind:*`, has no `lockfile:*` label, and
  - a nearest lockfile exists but is under an unsupported importer root

### Tests (in this PR)

Add a focused exporter test under `tools/tests/exporter/` that:

- constructs a simulated graph containing a Node or Python target that has:
  - `kind:*`
  - no `lockfile:*` label
  - a nearest lockfile located under an unsupported root (example: `services/api/pnpm-lock.yaml`)
- runs the exporter in CI-strict validation mode
- asserts:
  - the exporter emits the deterministic unsupported-importer finding
  - the output graph does not contain a `lockfile:*` label for that target

### Docs (in this PR)

Update `build-tools/docs/build-system-design.md` (exporter section) to clarify observed behavior:

- The exporter may attach `lockfile:<path>#<importer>` only when the computed importer is supported.
- Unsupported importer roots must be fixed by moving the lockfile under `apps/*`, `libs/*`, or repo root, or by extending the supported importer predicate with parity checks.

### Acceptance Criteria

- The exporter never auto-attaches importer-scoped lockfile labels with unsupported importer values.
- The exporter produces deterministic findings when it detects a nearest lockfile that would yield an unsupported importer.
- Existing behavior for supported importers under `apps/*`, `libs/*`, or `.` remains unchanged.

### Risks

Moderate. This can surface latent repo layouts where lockfiles exist under unsupported roots and were accidentally relied upon by exporter auto-attachment.

### Consequence of Not Implementing

The exporter can keep generating labels that violate the macro contract, causing failures that look like “macro validation broke” even though the exporter introduced the invalid label.

### Downsides for Implementing

Slightly stricter exporter behavior may require moving lockfiles or extending the supported importer predicate if the repo layout is broader than the current policy.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

Touches only exporter code plus one narrow exporter test and a doc update.

---

## PR‑2: Remove implicit global state and optional `fs-extra` dependency from Go exporter module labeling

### Description

Go module labeling in `tools/buck/exporter/labeler.ts` depends on two implicit behaviors:

- A process-global `__GO_LIST_CACHE` populated by `exporter/main.ts`
- A fallback path that dynamically imports `fs-extra` to read `go.mod` for a conservative label attach in an edge case

This works, but it makes the abstraction leak in two ways:

- Module labeling is not a pure function of `(nodes, batches, go list results)` because it depends on global state.
- The fallback introduces an optional dependency on `fs-extra` in a core exporter path and makes behavior sensitive to runtime module availability.

This PR makes the Go labeler’s inputs explicit and removes the optional dependency surface.

### Scope & Changes

- Update `tools/buck/exporter/main.ts` and `tools/buck/exporter/labeler.ts` so that:
  - `attachGoModuleLabels(...)` receives Go list results via an explicit parameter (for example, a `Map<Batch, GoPkg[]>`), not via `global.__GO_LIST_CACHE`
  - the labeler no longer dynamically imports `fs-extra`
  - any remaining filesystem access uses `node:fs/promises` (or the fallback is removed entirely if it is no longer needed)
- Keep label output stable for existing targets.

### Tests (in this PR)

Add or update exporter tests to lock down behavior without relying on global state:

- a test that calls the Go labeler directly with an explicit batch → packages mapping and asserts the resulting `module:*` labels are identical to the baseline fixture
- a test that runs the exporter end-to-end and asserts:
  - Go labeling still works
  - there is no dependency on `global.__GO_LIST_CACHE` for correctness (exercise by using simulate mode or by disabling the cache population path)

### Docs (in this PR)

Update `build-tools/docs/build-system-design.md` (exporter section) to state the contract in concrete terms:

- Go module labels are derived from authoritative `go list` results per tuple batch.
- The exporter does not rely on process-global caches as a contract.

### Acceptance Criteria

- Go module labels produced by the exporter are unchanged for the same inputs.
- `tools/buck/exporter/labeler.ts` no longer uses `global.__GO_LIST_CACHE`.
- `tools/buck/exporter/labeler.ts` no longer imports `fs-extra`.

### Risks

Low to moderate. The main risk is accidentally changing module labeling behavior in edge cases, which should be covered by fixtures and direct labeler tests.

### Consequence of Not Implementing

The exporter retains hidden coupling through global state and optional dependencies, which increases the chance of non-obvious regressions during refactors.

### Downsides for Implementing

Some refactoring churn across exporter wiring and tests.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

Touches only exporter code, plus exporter tests and a doc update.

---

## PR‑3: Make Node “synthetic lockfile providers” an explicit, opt-in contract

### Description

Node provider sync currently discovers lockfiles using a Node-only helper that includes “synthetic” `pnpm-lock.yaml` paths for workspace importers that have `package.json` but do not have an actual lockfile yet.

This behavior is not inherently wrong, but it is a contract leak today:

- The system’s label contract is “importer-scoped lockfile labels point at real lockfiles,” while provider sync can generate providers keyed by lockfile paths that do not exist.
- The behavior is useful during early scaffolding, but it should be explicit and hard to accidentally depend on.

This PR makes synthetic lockfile providers opt-in, so the default behavior aligns with the lockfile label contract.

### Scope & Changes

- Update `tools/buck/providers/node.ts` to:
  - disable synthetic lockfile discovery by default
  - add an explicit option or environment flag to enable it (example: `NODE_PROVIDER_SYNTHETIC_LOCKFILES=1`)
- Update provider index generation and any prebuild checks (if needed) so they do not assume synthetic providers are present by default.
- Keep provider naming and output format stable.

### Tests (in this PR)

Add a focused provider test under `tools/tests/providers/` that:

- creates a temp workspace importer under `apps/*` with `package.json` but no `pnpm-lock.yaml`
- runs Node provider sync with default settings and asserts:
  - no provider is generated for that importer
- runs Node provider sync with synthetic mode enabled and asserts:
  - a metadata-only provider is generated deterministically for that importer

### Docs (in this PR)

Update the provider sync documentation to describe observed behavior:

- Node provider sync supports an opt-in synthetic mode for early scaffolding.
- Default behavior generates providers only for real `pnpm-lock.yaml` files.
- The synthetic mode does not change the lockfile label contract for targets.

### Acceptance Criteria

- Default Node provider sync does not generate providers for non-existent lockfiles.
- When synthetic mode is enabled, the previous behavior can be recovered deterministically.
- No changes to auto-map behavior are required.

### Risks

Moderate. If someone relied on synthetic providers as an implicit behavior, disabling it by default will change local behavior. The tests should make the mode boundary explicit.

### Consequence of Not Implementing

The repo keeps a real behavior that is not an explicit contract boundary, which makes later debugging and refactors harder.

### Downsides for Implementing

Adds one more explicit knob for a niche behavior.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

Touches Node provider sync plus one provider test and a doc update.

---

## PR‑4: Reduce drift risk by consolidating importer-scoped exporter adapter wiring (Node + Python)

### Description

Node and Python exporter adapters implement near-identical control flow:

- validate kind label presence when macro-stamped
- validate importer-scoped lockfile label shape
- attach a nearest lockfile label when kind is present and lockfile label is missing

This similarity is intentional, but repeated code creates drift risk, especially when tightening contracts like supported-importer enforcement.

This PR consolidates the importer-scoped adapter wiring into a shared helper so Node and Python stay aligned.

### Scope & Changes

- Introduce a small shared helper under `tools/buck/exporter/lang/` that:
  - runs the common validation steps
  - runs the common attach step (including the supported importer enforcement from PR‑1)
  - standardizes finding prefixes and guidance text
- Update:
  - `tools/buck/exporter/lang/node.ts`
  - `tools/buck/exporter/lang/python.ts`
    to use the shared helper.

This PR should be a refactor with no behavior change relative to PR‑1, except for improved consistency of messages.

### Tests (in this PR)

- Update existing exporter adapter tests (or add a narrow new one) that asserts:
  - Node and Python adapters produce the same style of findings for the same classes of contract violations (missing kind, malformed lockfile label, unsupported importer on auto-attach path).

### Docs (in this PR)

Update exporter authoring notes in `build-tools/docs/build-system-design.md` to point at the shared helper as the canonical place to implement importer-scoped attachment and validation.

### Acceptance Criteria

- Node and Python exporter adapter behavior is unchanged compared to PR‑1 baseline for equivalent inputs.
- Common contract validation behavior is implemented in one place.

### Risks

Low. This is primarily a refactor, but it touches exporter behavior, so adapter tests must guard it.

### Consequence of Not Implementing

Node and Python exporter adapters will continue to duplicate logic, increasing the chance of contract drift during future changes.

### Downsides for Implementing

Small churn for a refactor, plus test updates.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

Touches only exporter adapter code, plus a small exporter test update and a doc update.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and blast radius:

1. PR‑1 first. It prevents the exporter from generating labels that the macro layer will reject.
2. PR‑2 next. It removes hidden coupling in Go module labeling without changing user-facing contracts.
3. PR‑3 next. It makes Node synthetic provider behavior explicit by introducing an opt-in boundary.
4. PR‑4 last. It consolidates importer-scoped exporter adapter wiring once the behavioral contract is tightened.

---

## Verification & Backout Strategy

Each PR includes:

- A focused regression test that fails if the tightened contract or standardized behavior regresses.
- A doc update that describes user-visible behavior in concrete “what happens” terms.

Backout strategy:

- Each PR is independently revertible.
- If a regression is discovered:
  - revert the PR and its tests/docs together
  - keep any new tests only if they still reproduce the issue on the prior baseline and remain meaningful
