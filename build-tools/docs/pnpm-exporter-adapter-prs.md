## PNPM Exporter Adapter — PR Plan (Validate‑Only + Sidecar + Composite API)

This plan turns the design in `pnpm-exporter-adapter.md` into a sequence of focused PRs. We keep macros as the single source of truth (SST) for Node importer‑scoped labels and patch invalidation, add a validate‑only exporter adapter, emit a deterministic sidecar index, and introduce a composite graph API for all tooling.

No backwards‑compat concerns: this project is not yet used.

---

### PR 1 — Validate‑Only Node Exporter Adapter + Sidecar Emission

Scope

- Add `tools/buck/exporter/lang/node.ts` with `adapter: { name: "node", isNode, validate, attachLabels }`.
  - `validate` (warn local, error in CI):
    - Exactly one importer‑scoped lockfile label present per Node target: `lockfile:<path>#<importer>`.
    - Malformed importer or mismatched path/importer → finding.
  - `attachLabels`: pass‑through (no label synthesis or mutation).
- Emit `tools/buck/node-lock-index.json` during glue (`tools/buck/gen-provider-index.ts`):
  - Map `"//pkg:rule" -> "lockfile:<path>#<importer>"` for targets with valid labels.
  - Deterministic: sort by fully‑qualified target label; use `writeIfChanged` to be idempotent.

Acceptance Criteria

- Exporter completes with 0 findings on a clean repo (or expected warnings with `--validation=warn`).
- `tools/buck/node-lock-index.json` exists, is sorted, and re‑running export yields no diff.
- No changes to target invalidation behavior.

Verification

- Run:
  - `node tools/buck/export-graph.ts --out tools/buck/graph.json`
  - `node tools/buck/gen-provider-index.ts`
  - Confirm `tools/buck/node-lock-index.json` is created and stable across two runs.
- Negative checks:
  - Remove a Node lockfile label from a sample target; rerun export → validation finding appears; CI mode would error.

Consequences of Not Implementing

- Missing uniform validation for Node targets; mis-stamped or unlabeled targets may go unnoticed.
- No sidecar index; downstream tools either duplicate parsing logic or rely on raw `graph.json` heuristics.
- Slower diagnostics and increased drift risk between macros and tooling expectations.

---

### PR 2 — Composite Graph API + CLI

Scope

- Add `tools/lib/graph-view.ts` (or extend `tools/lib/graph.ts`) with a single exported type `CompositeGraphView` and `readCompositeGraph()`:
  - Loads `tools/buck/graph.json`.
  - Loads sidecars: `third_party/providers/provider_index.json` and `tools/buck/node-lock-index.json`.
  - Returns a normalized composite structure for consumers (providers + importer lock mapping).
- Add `tools/buck/graph-view.ts` CLI to print the composite view for scripts/dashboards.

Acceptance Criteria

- Library returns a typed composite object; CLI prints JSON.
- Internal scripts can be trivially updated to use the composite API.

Verification

- Run: `node tools/buck/graph-view.ts | jq .` and spot‑check keys for representative targets.

Consequences of Not Implementing

- Future tools will be tempted to consume `graph.json` directly, fragmenting parsing logic.
- Harder to evolve internals (schemas, sidecars) without breaking multiple consumers.
- Inconsistent results across scripts/dashboards due to ad‑hoc readers.

---

### PR 3 — Schema + Versioning + Exporter Banner

Scope

- Add `$schema` and `version` fields to both `tools/buck/graph.json` and `tools/buck/node-lock-index.json`.
- On successful export, print a short banner that references the Composite Graph API and current schema version.

Acceptance Criteria

- Both JSON files include `$schema` and `version` fields.
- Exporter logs contain a one‑line pointer to the composite API.

Verification

- Rerun exporter and inspect the files/logs; confirm presence of fields and banner.

Consequences of Not Implementing

- Consumers cannot assert compatibility; silent breakages when structures evolve.
- Mixed expectations about file shapes across teams; harder migrations later.

---

### PR 4 — Prebuild Guard Freshness for Sidecar

Scope

- Extend `tools/buck/prebuild-guard.ts`:
  - Fail if `tools/buck/node-lock-index.json` is missing.
  - Fail if it is older than `tools/buck/graph.json`.
  - Optionally, also fail if older than any `TARGETS`/`*.bzl` that affect labeling.

Acceptance Criteria

- Guard fails with actionable messages when the sidecar is missing or stale.

Verification

- Delete or touch timestamps to simulate staleness and confirm guard behavior; fix by re‑exporting.

Consequences of Not Implementing

- Stale `node-lock-index.json` can leak into builds/tests, causing confusing or inconsistent invalidation.
- Flaky CI due to unnoticed drift between exporter outputs and sidecars.

---

### PR 5 — CI Tooling‑Contract Gate + ESLint Rule (Optional)

Scope

- CI job: forbid new code paths that read `tools/buck/graph.json` directly.
  - Simple grep with an allowlist: exporter internals and composite API are exempt.
- Optional: ESLint custom rule in repo scripts to flag raw graph reads.

Acceptance Criteria

- CI fails when a new file references `tools/buck/graph.json` directly (unless allowlisted).

Verification

- Add a temporary test script that reads `graph.json` directly → CI should fail; remove it → CI passes.

Consequences of Not Implementing

- New tooling may bypass the composite API, re‑introducing raw `graph.json` coupling.
- Harder to apply future schema changes without broad churn.

---

### PR 6 — Adapter Validation Tests

Scope

- Add zx/node tests that run the exporter with controlled graphs to exercise:
  - Missing lockfile label on a Node target → finding (warn local, error CI).
  - Multiple lockfile labels → finding.
  - Malformed `lockfile:<path>#<importer>` → finding.

Acceptance Criteria

- Tests pass locally; failure messages are descriptive and actionable.

Verification

- `v` (or project test runner) passes; individual tests pass when run standalone.

Consequences of Not Implementing

- Regressions in validation logic may slip into main and only surface indirectly.
- Lower confidence that CI enforces single‑label and format guarantees for Node targets.

---

### PR 7 — Sidecar Determinism + Prebuild‑Guard Tests

Scope

- Determinism:
  - Unit test that sidecar output is stably sorted and `writeIfChanged` prevents unnecessary rewrites.
- Prebuild‑guard:
  - Tests for missing/stale sidecar relative to `graph.json` (and optionally `TARGETS`/`*.bzl`).

Acceptance Criteria

- Tests cover happy path and failure modes; outputs match documented messages.

Verification

- Run tests with and without touching timestamps; confirm expected outcomes.

Consequences of Not Implementing

- Non‑deterministic sidecar output may cause noisy diffs and cache churn.
- Guard behavior around stale/missing sidecar remains untested; failures may surprise developers.

---

### PR 8 — Documentation

Scope

- Update `docs/handbook/conventions.md` with:
  - Composite Graph API as the single supported consumption path.
  - Schema/version policy and link.
  - Exporter banner message reference.
- Cross‑link from `build-tools/docs/build-system-design.md` and `pnpm-exporter-adapter.md` to the composite API and sidecar description.

Acceptance Criteria

- Docs clearly state SST (macros), validation role of the exporter, and composite API usage.

Verification

- Have a teammate follow the docs to read the composite view and intentionally trigger a validation finding.

Consequences of Not Implementing

- Onboarding friction; teams may default to raw `graph.json` and miss validation guidance.
- Greater chance of misuse and repeated questions about the correct consumption path.

---

### PR 9 — Optional: Diagnostics/Telemetry Polish

Scope

- Add minimal counters/timing to exporter logs for Node adapter validation time and sidecar emission (kept quiet by default).

Acceptance Criteria

- Logging remains succinct by default; a verbose mode (`EXPORTER_VERBOSE=1`) shows timing.

Verification

- Run exporter with verbose flag and confirm presence of timing lines.

Consequences of Not Implementing

- Harder to diagnose exporter performance issues or validate incremental cost of validations.
- Less observability during future scaling work (acceptable if simplicity is preferred).

---

## Reference: Core Design Invariants

- Single Source of Truth: Node macros stamp importer labels and include importer‑local patches in target `srcs` for precise invalidation.
- Exporter adapter is validate‑only; it never invents or mutates labels.
- Sidecar is a deterministic, read‑only projection derived exclusively from labels already present in `graph.json`.
- Tooling must consume the Composite Graph API; raw `graph.json` is not a supported interface.
