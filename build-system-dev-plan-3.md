# Build System Dev Plan — Phase 3 (Follow-ups to PRs 1–4)

Purpose: Close remaining gaps versus the implementation guide while keeping scope incremental and testable. Node importer-scoped wiring and CI stale-check behavior are intentionally deferred per discussion.

References:

- See `build-system-design.md` sections:
  - Exporting the Buck Graph (ZX) — authoritative module labeling (L282–L318)
  - Buck2 as Orchestrator: Inputs & impact (L114–L124)
  - Phase 3/8 guidance on batching and config tuples (L548–L572, L621–L629)
  - Go macros and provider attachment (L1229–L1261)

## Overview of Remaining Gaps (in scope for this plan)

1. Exporter config tuple completeness
   - Current: batches group by `(GOOS, GOARCH, CGO)` and module root; `tagsKey` and toolchain hash are placeholders.
   - Target (per guide): include build tags, GOFLAGS/env, and toolchain identity in tuple and cache keys so module labels reflect per-target configs.

2. Per-target tag awareness
   - Current: exporter cannot derive build tags from targets/macros, potentially producing shared labels across configurations.
   - Target: propagate tag/platform signals from Buck targets to exporter batching/labeling.

3. Optional helper missing
   - `tools/lib/fs-helpers.ts::writeIfChanged` (guide appendix) is not present. Not strictly required, but helpful for future steps and consistency.

## Proposed PR Sequence

### PR A — Exporter: Config Tuple Hardening

Scope:

- Enhance `tools/buck/export-graph.ts` to compute a stable config tuple per batch that includes:
  - GOOS, GOARCH, CGO (existing)
  - build tags (sorted; from target labels or macro attrs, see PR B)
  - GOFLAGS (if present)
  - Toolchain hash placeholder: read `go env` + selected environment inputs (e.g., `GOTOOLCHAIN`, `GOROOT` hash via `go env GOROOT` + os/arch) and fold into a short hash for the tuple.

Design alignment:

- Matches “batch by config tuple” guidance in `build-system-design.md` (Phase 3, L557–L565; Phase 8, L621–L629).

Implementation details:

- Add a `gatherToolchainIdentity()` helper that shells `go env` for `GOROOT` and encodes `(GOOS, GOARCH, CGO, GOROOT)` into a short SHA-256 digest.
- Include `GOFLAGS` and build-tags string into the tuple key when present.
- Extend on-disk cache key to include the full tuple and lock-hash (gomod2nix.toml preferred; fallback go.mod+go.sum), as already partially implemented.

Tests:

- zx tests under `tools/tests/exporter/`:
  - `exporter.tuple.includes-goflags.test.ts`: set `GOFLAGS='-tags=foo,bar'` and verify batches change vs. default.
  - `exporter.tuple.includes-toolchain.test.ts`: mock `GOROOT` environment via a shim to validate tuple hash changes.
  - Ensure one-test-per-file and wire via `TARGETS` with `zx_test`.

Acceptance:

- Exporter produces distinct batch keys when GOFLAGS or toolchain inputs change.
- Metrics show cache hits/misses consistent with tuple changes across runs.

### PR B — Propagate Build Tags/Platforms From Targets

Scope:

- Augment the Buck macros (`go/defs.bzl`) to surface configuration hints for the exporter:
  - Add optional `labels` of the form `gotags:<comma-sorted>` and `goenv:GOOS=<v>`, `goenv:GOARCH=<v>`, `goenv:CGO_ENABLED=<0|1>` when users specify those via macro kwargs.
  - Do not change Buck behavior; only enrich labels so exporter can read them.
- Update `tools/buck/export-graph.ts` to collect these labels per target and include them in batch tuple formation (targets in the same batch must share the same derived tags/env set).

Design alignment:

- Mirrors the guide’s “attrs affect the config tuple” note (L516–L536, L538) and ensures authoritative exporter labels reflect real per-target configs (L557–L570).

Implementation details:

- In macros, compute tag/env label strings deterministically (sorted tags; lowercased values where appropriate) and append to `labels` passed through to Buck nodes.
- In exporter, read labels with prefixes `gotags:` and `goenv:` while grouping members; if a conflict exists inside a would-be batch, split batches by conflicting tuples.

Tests:

- zx tests under `tools/tests/exporter/`:
  - `exporter.per-target.tags-affect-labels.test.ts`: create two simple go targets with differing `build_tags`, confirm their `module:` label sets differ when imports diverge due to tags.
  - `exporter.per-target.platform-splits-batches.test.ts`: differing `GOOS/GOARCH` produce distinct batches.

Acceptance:

- Changing tags/platforms in a target modifies that target’s module labels but not unrelated ones.
- Exporter batches separate per unique tuple.

### PR C — Add fs-helpers::writeIfChanged and Refactor Callers (Optional Cleanliness)

Scope:

- Add `tools/lib/fs-helpers.ts` with `writeIfChanged(dst, data)` from the guide (Appendix, L1165–L1184).
- Refactor small call sites where write-if-changed is open-coded (e.g., `gen-auto-map.ts`, `sync-providers.ts`) to use the helper for consistency.

Design alignment:

- Matches the guide’s shared helper pattern; keeps idempotent writes consistent.

Tests:

- Lightweight zx tests for the helper (write same content twice → second is no-op).
- Ensure existing generator tests remain green.

Acceptance:

- No behavior change; logs include no-op messages where applicable; tests still pass.

## Risks & Mitigations

- Over-splitting batches due to noisy inputs
  - Mitigate by limiting tuple inputs to stable, intentional signals: GOOS/GOARCH/CGO, deterministic tag lists, GOFLAGS, and a stable toolchain hash.
- Tag discovery vs. user experience
  - We opt for explicit tags via macros to avoid guessing from source; keeps control in `TARGETS` and aligns with the guide’s macro-forwarded attrs.

## Rollout & Verification

1. Land PR A, run full suite with coverage; inspect exporter metrics and cache behavior on CI/local.
2. Land PR B, re-run suite; add a focused test demonstrating target A vs B differing only by tags.
3. Land PR C, ensure no behavioral diffs in tests; verify logs for no-op writes.

## Out of Scope (tracked separately)

- Node importer-scoped provider wiring (defs_node.bzl, Node labels in exporter)
- CI stale-check behavior (local auto-fix kept as discussed)
