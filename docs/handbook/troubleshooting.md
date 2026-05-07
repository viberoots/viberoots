# Troubleshooting

## Bootstrap-safe glue

- Glue and CI entrypoints are bootstrap-safe and do not depend on `fs-extra`. They can run before `node_modules` exists.
- If you see early failures related to missing Node deps, ensure you’re invoking the documented glue stages directly (or `build-tools/tools/dev/install-deps.ts --glue-only`) in the dev shell. The scripts use only built-in Node `fs` APIs and zx.

## Missing auto_map or graph

- The planner has no fallback discovery; you must regenerate glue locally or in CI.
- Run locally:
  - `node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`
  - `node build-tools/tools/buck/sync-providers.ts` (unified orchestrator; Node sync runs automatically when PNPM lockfiles are present)
  - `node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`
  - Or: `node build-tools/tools/dev/install-deps.ts --glue-only`
- In CI, run dedicated stages before build/test:
  - `build-tools/tools/ci/run-stage.ts --stage export-graph`
  - `build-tools/tools/ci/run-stage.ts --stage sync-providers`
  - `build-tools/tools/ci/run-stage.ts --stage gen-auto-map`
  - `build-tools/tools/ci/run-stage.ts --stage prebuild-guard`

## Missing importer provider (Node)

- Symptom: prebuild guard or Buck errors referencing a missing `node_importer_deps(...)` for a given `pnpm-lock.yaml#importer`.
- Fix (local):
  - `node build-tools/tools/buck/sync-providers.ts` (unified orchestrator regenerates `third_party/providers/TARGETS.node.auto`)
  - `node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`
  - Ensure the Node target carries a lockfile label like `lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web`.
- Fix (CI): run the dedicated stages before build/test as above.

## No-op sync (Node)

- Symptom: running Node provider sync makes no changes.
- Expected reasons:
  - No `pnpm-lock.yaml` files are present at repo root or under `apps/*` / `libs/*`.
  - Importers exist but no relevant `patches/node/*.patch` exist for their effective sets (normal — providers still emit without patch paths).
  - YAML module unavailable; generator falls back to per‑lockfile providers without importer traversal.
- Fix:
  - Verify lockfiles exist and contain `importers` entries for your app/lib.
  - Add or modify patches under `<importer>/patches/node/*.patch` (importer‑local) or `patches/node/*.patch` (global), then re-run sync.
  - Re-run auto_map after sync.

## Stale sidecar (build-tools/tools/buck/node-lock-index.json)

- Symptom: graph consumers (Composite Graph API) warn about a missing or stale Node sidecar.
- Fix:
  - Regenerate exporter outputs: `node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`
  - Re-run prebuild guard: `node build-tools/tools/buck/prebuild-guard.ts`
- Notes:
  - Downstream tools MUST use the Composite Graph API (`build-tools/tools/lib/graph-view.ts` or `build-tools/tools/buck/graph-view.ts`) rather than reading `graph.json` directly.

## Overrides in CI

- Ensure `NIX_GO_DEV_OVERRIDE_JSON` and `NIX_CPP_DEV_OVERRIDE_JSON` are unset. Locally, use `build-tools/tools/dev/clear-overrides.ts`.
- Shared helper: `build-tools/tools/nix/lib/lang-helpers.nix` centralizes override parsing and CI guard (`readDevOverrides`, `guardNoDevOverridesInCI`). Templates import it to emit a local warning (trace) when overrides are set and to throw in CI if overrides are present.

## Duplicate/malformed patches

## Go import lookup errors (vendor mode)

- Symptom: `import lookup disabled by -mod=vendor` or `go.mod not found`.
- Cause: builder working directory not at module root, or vendor mode assumptions.
- Fix:
  - Ensure `build-tools/tools/nix/lang-templates.nix` sets `pwd`/`modRoot` to the module root and `subPackages` as documented (apps: `cmd/<name>`, libs: `.`).
  - Regenerate glue and rebuild via Nix (`nix build .#graph-generator`).

## Manifest missing or empty

- Symptom: tests cannot find binaries or `manifest.json` is empty.
- Fix:
  - Run glue: `node build-tools/tools/buck/glue-pipeline.ts` (or `node build-tools/tools/buck/prebuild-guard.ts` in local mode).
  - Ensure `gomod2nix.toml` exists at repo root (copy from the authoritative module lock).
  - Inspect `$out/build.log` for target keys and bin discovery.

## No vendoring guard fails

- Symptom: CI test `linting_no_vendored_go` fails with `.go` files under `third_party/go`.
- Fix: remove vendored files; do not copy from `GOMODCACHE`. Third‑party is resolved by Nix and `gomod2nix.toml`.

- Ensure one patch per `module@version`; file name must be `<encodedImport>@<version>.patch`.

## Node patch changes don’t seem to invalidate targets

- Ensure each Node target carries exactly one importer‑scoped lockfile label: `lockfile:<path>#<importer>` (macros enforce this).
- Place patches under the importer’s directory: `<importer>/patches/node/*.patch` (e.g., `apps/web/patches/node/…`).
- Remember: Node provider rules do not use patch paths as `srcs`; invalidation is driven by macros including the importer‑local patches in target `srcs`.
- Importer detection is automatic (the tools walk upward to the nearest `pnpm-lock.yaml`). Override explicitly with `--importer <dir>` if your layout is unusual.
- Run glue regeneration if needed: export graph → sync providers → gen auto_map, or run the prebuild guard locally to auto‑fix.

## Invalidation report (what invalidates what?)

When I’m debugging “why did this rebuild?” or “why didn’t this rebuild?”, I start with the invalidation report. It’s a deterministic, line-oriented view of each target’s patch scope, importer/lockfile metadata, whether global Nix inputs are expected as real action inputs, and the realized provider edges (as a debugging aid).

- **Where it lives**: `build-tools/tools/buck/invalidation-report.txt` (generated; do not hand-edit)
- **How to regenerate**:
  - `node build-tools/tools/buck/glue-pipeline.ts` (preferred; refreshes all glue, then emits the report)
  - Or: `node build-tools/tools/buck/invalidation-report.ts` (report-only; expects existing `graph.json` and `auto_map.bzl`)

## Exporter simulate vs authoritative

- For hermetic tests, use `--simulate`. CI uses authoritative mode.

### Prebuild guard (glue presence & freshness)

The prebuild guard verifies that generated glue files exist and are fresh relative to their inputs.

- What it checks
  - Presence: `build-tools/tools/buck/graph.json`, `third_party/providers/auto_map.bzl`, and any `third_party/providers/TARGETS*.auto` files (when patches or lockfiles exist).
  - Freshness: compares newest input (any `TARGETS`, `*.bzl`, `patches/**/*.patch`, or `**/pnpm-lock.yaml`) against the oldest glue output, with an allowed skew.

- Local behavior
  - Default: auto-fixes glue by running generation in order: export-graph → sync-providers → gen-auto-map.
  - Warnings only: set `PREBUILD_GUARD_NO_FIX=1` to disable auto-fix; guard will print WARN lines instead.

- CI behavior
  - Fails fast with `ERROR:` lines on missing or stale glue. Use the CI stages (Export Graph → Sync Providers → Generate auto_map) to refresh glue.

- Environment variables
  - `PREBUILD_GUARD_NO_FIX=1`: disable local auto-fix; print WARN lines instead (CI always fails).
  - `PREBUILD_GUARD_VERBOSE=1`: print top offenders for freshness (newer inputs and older outputs). Equivalent to `--verbose`.
  - `PREBUILD_GUARD_SKEW_MS=2000`: allowed mtime skew in milliseconds before glue is considered stale.
  - `PREBUILD_GUARD_LIST_LIMIT=5`: number of files listed when verbose; can be overridden by `--verbose-limit`.

- CLI diagnostics
  - Verbose: `node build-tools/tools/buck/prebuild-guard.ts --verbose --verbose-limit 10`
  - JSON: `node build-tools/tools/buck/prebuild-guard.ts --json > guard.json`

- Typical commands
  - Local auto-fix: `node build-tools/tools/buck/prebuild-guard.ts`
  - CI sequencing: run the three glue steps explicitly before building or testing.

### Patches lint

Validate patch filenames and directory shape to prevent cache/key churn and misapplied patches.

- Rules (Go)
  - Files must be flat under `patches/go/` (no subdirectories).
  - Filenames must be `<importPath-encoded>@<version>.patch` with `/` encoded as `__`.
  - Exactly one patch per `module@version` (case-insensitive).
  - Non-`.patch` files under `patches/go/` are violations (e.g., `.gitkeep`).

- Usage
  - Advisory (default): `node build-tools/tools/dev/patches-lint.ts`
  - Strict (CI/hooks): `node build-tools/tools/dev/patches-lint.ts --strict`
  - JSON output: `node build-tools/tools/dev/patches-lint.ts --format json`
  - Scope language: `node build-tools/tools/dev/patches-lint.ts --lang go`

- Exit policy
  - Advisory: prints diagnostics and exits 0.
  - Strict: exits 1 if any violations.

### Glue regeneration (quick reference)

- Local sequence (not committed): export-graph → sync-providers → gen-auto-map.
  - Run `node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`
  - Run `node build-tools/tools/buck/sync-providers.ts`
  - Run `node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`
  - Or run `node build-tools/tools/dev/install-deps.ts` (dev shell) which chains them for you.
- CI sequence: the same steps as separate stages before build/test.

### Prelude-gated tests (dev shell)

- Some zx tests probe `@prelude` availability using `buck2 cquery`.
- If unavailable, the test prints a SKIP message and exits early; enter the dev shell and re-run.
- See Testing handbook for external timeouts and coverage.

### Exporter metrics (optional)

- You can ask the exporter to write a small JSON metrics file for observability.
- Usage: `node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json --metrics-out build-tools/tools/buck/export-metrics.json`
- The metrics write is best-effort and does not change export behavior.

## Vercel control-plane deployments

Protected/shared Vercel deploy, preview, preview cleanup, retry, and rollback
operations route through the reviewed deployment control-plane service. Use
this section when one of those operations rejects, fails closed, or records an
unexpected outcome.

### Service submission rejections

- Symptom: the public front door rejects a protected/shared Vercel mutation
  before contacting the control-plane service.
- Likely causes:
  - The invocation passes a laptop-local artifact directory or records root
    that the public front door does not accept for protected/shared targets.
  - A deploy or preview omits the `--source-run-id` selector for the admitted
    Vercel prebuilt artifact lineage.
  - The invocation passes a direct local-publish flag that is reserved for
    `local_only` Vercel fixtures.
  - `--control-plane-url` (or the reviewed `--profile` workflow) is missing.
- Fix:
  - Re-run with `--control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"` (or the
    reviewed profile), pass the admitted `--source-run-id`, and remove
    laptop-local artifact or records overrides.
  - For tests or development, use a `local_only` Vercel fixture deployment
    target instead of a protected/shared label.

### Admission and secret-runtime failures

- Symptom: the control-plane service rejects the submission with an admission
  or secret-runtime error before any provider API call.
- Likely causes:
  - Admission evidence is missing required checks for the admitted scope.
  - Phase 0 readiness evidence has the wrong `accessMode`, `gateVersion`,
    environment stage, provider target identity, source revision, or source run
    id for the deployment being admitted.
  - Gate 5 evidence is missing the exact `source`, `client`, or
    `policyCombination` required by the policy for Drive, Notion, Slack, GitHub,
    or external-source `fetch_full_document` denial.
  - A live readiness gate declares credentials without
    `credential_source = "secret_runtime"` and a reviewed `secret_runtime_step`.
  - The Vercel API token is not declared in `secret_requirements` for the step
    that needs it (`publish`, `smoke`, or `preview_cleanup`), or the contract
    is bound to a target scope that does not match the deployment's provider
    target identity.
- Fix:
  - Run `deploy --deployment <label> --validate-only` and inspect
    `admissionRequirements.required_checks` and `readiness_gates` to confirm
    submit-time evidence. Direct-upload pilot access uses Gates 1-4; connector
    demo access also requires the full Connect and GitHub Gate 5 set.
  - Declare a `vercel/api-token` `secret_requirement` for each step the
    operation enters, and confirm the contract's `targetScopes` match the
    `vercel:<team>/<project>#<environment>` lock-key shape.

### Frozen-snapshot admission drift

- Symptom: a Vercel, Kubernetes, or S3 static worker rejects a queued
  protected/shared submission as no longer admitted, or the persisted snapshot
  does not contain an `admittedContext.policyEvaluation`.
- Likely causes:
  - The queued submission did not pass through the shared provider admission
    preparation path.
  - Replay used a source-run selector whose recorded artifact identity no
    longer matches the frozen admission payload.
  - A test or fixture wrote a provider-local synthetic `admission` field instead
    of preserving the shared admission-engine result.
- Fix:
  - Re-submit through the public protected/shared front door so the service
    freezes the shared admission result and admitted artifact reference.
  - For fixtures, update the recorded execution snapshot to include
    `frozenExecutionSchemaVersion`, `admittedContext.policyEvaluation`, and the
    admitted artifact or source-run replay selector used by the worker.

### Submit idempotency reuse

- Symptom: a repeated Vercel, Kubernetes, or S3 static protected/shared submit
  returns the first `submissionId` with dedupe mode `duplicate` instead of the
  newly generated one.
- Reason: the shared submit layer dedupes provider submissions by normalized
  payload fingerprint. `submissionId` and `submittedAt` are transport fields;
  the fingerprint is based on operation kind, target identity, admitted
  artifacts, source-run or replay selectors, preview-cleanup inputs, expected
  source revision, and smoke overrides.
- Fix:
  - Treat this as expected when retrying the same intent after a lost response.
  - If a genuinely new run is needed, change the replay-relevant input, such as
    the source run, admitted artifact, operation kind, or smoke override.
  - If a record contains `requestFingerprint` starting with `direct:`, it was
    written by a stale provider-control-plane fixture or binary and should be
    regenerated through the reviewed service path.

### Missing replay snapshot for retry or rollback

- Symptom: retry (`--publish-only`) or rollback
  (`--publish-only --rollback`) fails with `vercel deploy record is missing
replaySnapshotPath` or rejects the source-run as unsuitable for replay.
- Likely causes:
  - The `--source-run-id` references a record that was not produced by a
    successful normal Vercel deploy on the same deployment label.
  - The recorded run pre-dates the introduction of the Vercel replay snapshot
    contract.
- Fix:
  - Select a `--source-run-id` for a prior successful normal deploy run for
    the same canonical live target identity.
  - Do not retry preview or cleanup runs as the source-run for a replay;
    only normal deploys produce replay snapshots.

### Ambiguous publish or cleanup outcomes

- Symptom: a Vercel deploy, retry, rollback, or preview cleanup run fails with
  `ambiguous publish outcome`, `ambiguous cleanup outcome`, or records
  `finalOutcome = "pending"` / `"ambiguous"` instead of success.
- Reason: the Vercel provider API returned an empty deployment id or URL, kept
  the deployment in a non-terminal state after the polling budget, or did not
  confirm preview cleanup. The control-plane service fails closed and never
  records a false success.
- Fix:
  - Inspect the persisted record for the run id, provider release id, public
    URL, and redacted error summary. Secret-runtime values are not written to
    the record.
  - Re-run the operation when the provider returns a determinate outcome. Do
    not bypass the failure by editing the recorded outcome.
  - If the record contains a provider release id for a pending or ambiguous
    run, reconcile that deployment in Vercel before retrying a live target.

### Rejected laptop-local artifact paths

- Symptom: a protected/shared Vercel deploy, preview, retry, or rollback rejects an artifact path
  that points inside the laptop or worktree before the control-plane service
  runs.
- Reason: protected/shared Vercel mutations only accept admitted, identity-bound
  artifact references through the reviewed staging path.
- Fix:
  - Use the reviewed staging or `mini` artifact admission flow so the
    artifact identity is recomputed from the staged bytes.
  - For tests or local development, switch to a `local_only` Vercel fixture
    deployment label.

## OpenTofu Kubernetes Applies

- Symptom: a protected/shared Kubernetes provision-only or app-attached run
  rejects before `tofu apply`.
- Check the deploy record `provisionerPlan` and `provisionerApplyOutcome`
  fields. The worker requires an admitted provisioner plan fingerprint, plan
  fingerprint, stack config fingerprint, stack identity, and state backend
  identity before it resolves credentials or starts the adapter.
- Check the OpenTofu stack config: `plan_json` is reviewed JSON evidence, while
  `apply_plan` must be the separate saved plan artifact produced by
  `tofu plan -out=...`. Pointing `apply_plan` at JSON fails closed.
- Ensure the deployment declares required `secret_requirements` for
  `opentofu_provider_credentials` at the `provision` step. Missing or
  unauthorized credentials fail closed before the adapter runs.
- The production adapter uses `tofu` from the pinned Nix toolchain unless the
  worker profile sets `BNX_OPENTOFU_BIN` or `BNX_DEPLOY_OPENTOFU_BIN`.
- Plan or config drift appears as an OpenTofu apply mismatch in redacted
  diagnostics. Regenerate and re-admit the reviewed provisioner plan instead
  of applying from local workspace state.
