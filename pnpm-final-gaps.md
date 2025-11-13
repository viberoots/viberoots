## PNPM Final Gaps Plan — Achieving Practical Parity with Go/C++ (Validate‑Only Exporter Model Preserved)

This plan closes the remaining PNPM/Node gaps relative to Go and C++ while preserving the current design philosophy:

- Authoritative Go labeling via exporter; Node remains validate‑only with importer‑scoped labels stamped by macros.
- Deterministic, idempotent generators; minimal surface change; tests-first.
- No behavior regressions: Node invalidation continues to rely on importer‑local patches included by macros.

Below is a small, focused series of PRs. Each PR is independently useful, reversible, and testable. Together they deliver “feature parity” in practice: equivalent observability, safety, and determinism, while respecting that Node is intentionally validate‑only at the exporter level.

### PR 1 — Enrich Node provider sync with importer‑local patch visibility (no behavior change)

Rationale

- Improve observability to match Go/C++ diagnostics by listing importer‑local patches connected to each Node provider. Keeps providers metadata-only (srcs remain empty) and does not alter invalidation mechanics (macros already include importer-local patches in target srcs).

Scope

- Enhance `tools/buck/providers/node.ts` to discover importer‑local patches for each importer derived from lockfiles (e.g., `<importer>/patches/node/*.patch`) and include those paths in the generated `patch_paths=[...]` list.
- Keep `node_importer_deps` rule unchanged (still `srcs = []`); this is informational only.
- Add tests:
  - Determinism: idempotent `TARGETS.node.auto` with and without importer-local patches.
  - Visibility: when importer-local patches exist, `patch_paths` contains sorted entries for that importer; otherwise empty.
- Update docs to clarify `patch_paths` are purely diagnostic for Node providers; invalidation remains macro-driven.

Acceptance criteria

- `tools/buck/sync-providers.ts --lang node` produces identical outputs if inputs unchanged.
- With `<importer>/patches/node/*.patch` present, the corresponding provider includes these in `patch_paths` deterministically.
- No target builds change; prebuild guard remains green across scenarios (with/without patches).

Consequences if not implemented

- Continued gap in introspection parity vs Go/C++ (harder to reason about which patches impact which importer without reading importer directories).

Downsides

- Slightly more code and I/O in provider sync. Mitigated by scanning only importers found in lockfiles and keeping output deterministic.

### PR 2 — Hardening: Node adapter validation and macro consistency (precise, friendly failures)

Rationale

- Make misconfigurations obvious and uniform with other languages: ensure Node targets consistently carry `kind:*` and exactly one `lockfile:<path>#<importer>` label. Preserve the validate‑only exporter stance.

Scope

- Extend `tools/buck/exporter/lang/node.ts` validation to warn (CI=error) when:
  - `kind:*` is missing on Node targets using our macros.
  - `lockfile:` label count ≠ 1 (already enforced; expand messages with remediation).
  - Path/importer mismatch (already enforced; improve suggestions).
- Tests that cover: missing/multiple/malformed labels, missing `kind:*`, and correct messages. Keep local warn/CI error behavior.
- (Optional) Add a lint to forbid direct `graph.json` consumption in new scripts (ensure existing `tooling-contract` check covers Node sidecar usage).

Acceptance criteria

- Exporter in CI fails on malformed importer labels or missing `kind:*` when macros are used; local runs show actionable warnings.
- No change to label synthesis or runtime behavior; Node adapter remains validate‑only.

Consequences if not implemented

- Occasional soft failures later (e.g., auto-map surprises or missing providers) instead of immediate, actionable guidance.

Downsides

- Slightly stricter CI for Node targets; mitigated by precise error text and macro defaults that stamp `kind:*`.

### PR 3 — Documentation and troubleshooting consolidation (close the loop)

Rationale

- Make expected behavior explicit to reduce surprises for Node users and future maintainers; align guides with the validate‑only exporter model and importer‑local patches.

Scope

- Update documentation:
  - `pnpm-design.md`: clarify Node provider `patch_paths` semantics; emphasize importer‑local patch invalidation via macros; call out exporter sidecar (`tools/buck/node-lock-index.json`) and prebuild guard freshness.
- `pnpm-design.md`: clarify Node provider `patch_paths` semantics; emphasize importer‑local patch invalidation via macros; call out glue‑generated sidecar (`tools/buck/node-lock-index.json`) and prebuild guard freshness.
  - Handbook: troubleshooting entries for “missing importer provider”, “no‑op sync”, and “stale sidecar” with copy‑paste fixes (`node tools/buck/sync-providers.ts`, exporter rerun, etc.).
  - Reference the Composite Graph API and sidecars as the only supported consumption path.
- Tests: add/extend e2e wiring test to assert that an importer-local Node patch rebuilds only that importer’s targets.

Acceptance criteria

- Docs are consistent with current behavior and the changes from PR 1–2.
- e2e test passes and demonstrates importer-scoped invalidation clearly.

Consequences if not implemented

- Persisting confusion around `patch_paths`, importer-local patch locations, and when to re-run glue.

Downsides

- None (docs and tests only).

## Rollout notes

- Sequence: PR 1 and PR 2 can land independently; PR 3 may accompany either.
- Guardrails: Prebuild guard already enforces presence/freshness for Node sidecar and providers; no changes required.
- Backwards compatibility: No behavior changes for existing Node targets; parity gains are mostly observability and validation.

## Success criteria (end state)

- Provider wiring parity: Node providers deterministically reflect importer scope (existing), with enriched patch visibility (PR 1).
- Validation parity: Node targets reliably fail fast in CI for labeling/stamping mismatches (PR 2).
- Docs/tests: clear guidance and working end-to-end examples (PR 3).
