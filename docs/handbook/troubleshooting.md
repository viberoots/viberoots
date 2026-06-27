# Troubleshooting

## Bootstrap-safe glue

- Glue and CI entrypoints are bootstrap-safe and do not depend on `fs-extra`. They can run before `node_modules` exists.
- If you see early failures related to missing Node deps, ensure you’re invoking the documented glue stages directly (or `viberoots/build-tools/tools/dev/install-deps.ts --glue-only`) in the dev shell. The scripts use only built-in Node `fs` APIs and zx.

## Viberoots submodule state

- Missing or uninitialized submodule:
  - Prefer rerunning bootstrap in submodule mode:
    `curl -fsSL https://raw.githubusercontent.com/viberoots/viberoots/main/bootstrap | VBR_CONSUMER=submodule bash`
  - This initializes the submodule when needed, points `.viberoots/current` at `../viberoots`,
    repairs hidden workspace/devshell files, and runs any current bootstrap migration checks.
- Dirty submodule:
  - Inspect `git -C viberoots status --short`.
  - Commit or discard intentional viberoots-source edits in the submodule before parent validation.
- Gitlink mismatch:
  - Inspect `git submodule status viberoots`.
  - Either check out the parent-pinned revision with `git submodule update viberoots` or
    intentionally update the parent gitlink after the submodule commit exists. If you are upgrading
    the workspace to a newer viberoots ref, rerun latest-main bootstrap with
    `VBR_CONSUMER=submodule VBR_REF=<tag-or-commit>`.
- Old-layout blocker:
  - Root `build-tools/`, `third_party/providers/`, `prelude/`, and `toolchains/` should not exist in the parent workspace.
  - Generated provider and graph state belongs under `.viberoots/workspace/`.

## Missing auto_map or graph

- The planner has no fallback discovery; you must regenerate glue locally or in CI.
- Run locally:
  - `node --import ./viberoots/build-tools/tools/dev/zx-init.mjs --experimental-strip-types viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`
  - `node --import ./viberoots/build-tools/tools/dev/zx-init.mjs --experimental-strip-types viberoots/build-tools/tools/buck/sync-providers.ts` (unified orchestrator; Node sync runs automatically when PNPM lockfiles are present)
  - `node --import ./viberoots/build-tools/tools/dev/zx-init.mjs --experimental-strip-types viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`
  - Or: `node --import ./viberoots/build-tools/tools/dev/zx-init.mjs --experimental-strip-types viberoots/build-tools/tools/dev/install-deps.ts --glue-only`
- In CI, run dedicated stages before build/test:
  - `viberoots/build-tools/tools/ci/run-stage.ts --stage export-graph`
  - `viberoots/build-tools/tools/ci/run-stage.ts --stage sync-providers`
  - `viberoots/build-tools/tools/ci/run-stage.ts --stage gen-auto-map`
  - `viberoots/build-tools/tools/ci/run-stage.ts --stage prebuild-guard`

## Local generated-state bloat

- First preview safe cleanup with `viberoots gc --dry-run`.
- If the plan only includes Nix store cleanup and stale viberoots-owned generated paths, run `viberoots gc`.
- Use `viberoots gc --optimize` only for explicit maintenance. It currently adds Nix store deduplication and can take longer than normal cleanup.
- Do not run broad cleanup while verify is active; stop or wait for the run first.

## Missing importer provider (Node)

- Symptom: prebuild guard or Buck errors referencing a missing `node_importer_deps(...)` for a given `pnpm-lock.yaml#importer`.
- Fix (local):
  - `node --import ./viberoots/build-tools/tools/dev/zx-init.mjs --experimental-strip-types viberoots/build-tools/tools/buck/sync-providers.ts` (unified orchestrator regenerates `.viberoots/workspace/providers/TARGETS.node.auto`)
  - `node --import ./viberoots/build-tools/tools/dev/zx-init.mjs --experimental-strip-types viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`
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

## Stale sidecar (.viberoots/workspace/buck/node-lock-index.json)

- Symptom: graph consumers (Composite Graph API) warn about a missing or stale Node sidecar.
- Fix:
  - Regenerate exporter outputs: `node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`
  - Re-run prebuild guard: `node viberoots/build-tools/tools/buck/prebuild-guard.ts`
- Notes:
  - Downstream tools MUST use the Composite Graph API (`viberoots/build-tools/tools/lib/graph-view.ts` or `viberoots/build-tools/tools/buck/graph-view.ts`) rather than reading `graph.json` directly.

## Cloudflare Containers Deployments

- Unsupported provider during `--validate-only`:
  `unsupported deployment provider` means the deployment metadata did not
  resolve to a reviewed provider branch. Check for a provider typo, regenerate
  metadata from the `cloudflare_containers_deployment(...)` macro, and rerun
  `deploy --deployment <label> --validate-only`.
- Unsupported Containers ingress mode:
  `unsupported cloudflare-containers ingress_mode "<value>"` means
  `provider_target.ingress_mode` is not one of `public`, `private`, or `none`.
  Use `private` for the scaffold default, `public` only with reviewed routing
  metadata, or `none` for Worker-fronted services with no public route.
- Missing domain on protected/shared public ingress:
  the `protected/shared public cloudflare-containers deployments require domain`
  / `reviewed workers_dev_exception` error means public ingress has neither a
  custom domain nor a reviewed non-production `workers.dev` exception. Add
  `domain` and `cloudflare_zone_id`, switch the scaffold/deployment to private
  or no-ingress mode, or wire a reviewed target exception.
- Missing zone for a custom domain:
  `cloudflare_zone_id is required with domain` means the deployment declares a
  custom public hostname but not the owning Cloudflare zone id. Add
  `cloudflare_zone_id` to `provider_target` and keep the generated
  `wrangler.jsonc` route `zone_id` aligned with it.
- Invalid `workers_dev_exception` metadata:
  `workers_dev_exception requires an active reviewed target_exception` means the
  deployment set `workers_dev_exception = True` without an active exception
  whose affected deployment id, old provider target identity, and shared lock
  scope all match `cloudflare-containers:<account_id>/<worker>`.
  `production_facing cloudflare-containers deployments require a custom domain`
  means `workers.dev` is not accepted for production-facing Containers
  deployments. Use a custom domain and zone for production, or limit the
  exception to reviewed non-production metadata.
- Local Dockerfile rejected as an artifact:
  publish inputs must be an admitted service artifact directory or an immutable
  image digest file such as `sha256:<64 hex>`, not an ambient local Docker build.
- Live protected/shared mutation rejected:
  the first reviewed slice is `cloudflare-containers-local`; live Cloudflare API
  mutation needs a later reviewed publisher that uses the secret runtime,
  control-plane, retry, rollback, smoke, and record contracts.
- Smoke URL missing:
  public custom-domain deployments derive smoke URL from `domain`; private and
  no-ingress services need explicit smoke metadata or a reviewed smoke exception.

## Control-Plane Selector Diagnostics

- `protected/shared deployment_context <name> must select a valid controlPlane`:
  add `controlPlane` to the named `deploymentContexts.<name>` entry and ensure it
  points at a valid `controlPlanes.<profile>` profile. `--control-plane-url`,
  `VBR_DEPLOY_CONTROL_PLANE_URL`, `--remote`, and ambient token material cannot
  stand in for a context-selected protected/shared control plane.
- `rejected missing secretContext` or `rejected fixture fallback`: the selected
  `secret://...` control-plane token ref needs a real selected Vault or
  Infisical `DeploymentSecretContext`. Wire the context `secretBackend` and
  backend runtime metadata, or use `runtime://...` when the runtime host supplies
  the token. Fixture files are only for explicitly fixture-scoped tests.
- `controlPlanes.<name>...controlPlaneTokenRef must be a secret:// or runtime://`:
  fix the profile even if no deployment currently selects it. Shared and local
  config are merged first, then every `controlPlanes` entry is validated.
- `controlPlanes.<name>.<token field> must not contain a plaintext token`: remove
  plaintext fields such as `controlPlaneToken`, `token`, or `bearerToken` from
  shared and local config and replace them with a `controlPlaneTokenRef`.

## Overrides in CI

- Ensure `NIX_GO_DEV_OVERRIDE_JSON` and `NIX_CPP_DEV_OVERRIDE_JSON` are unset. Locally, use `viberoots/build-tools/tools/dev/clear-overrides.ts`.
- Shared helper: `viberoots/build-tools/tools/nix/lib/lang-helpers.nix` centralizes override parsing and CI guard (`readDevOverrides`, `guardNoDevOverridesInCI`). Templates import it to emit a local warning (trace) when overrides are set and to throw in CI if overrides are present.

## Remote build/cache readiness

- Symptom: `v` completed but did not run the whole test suite.
  - Meaning: plain `v` is scope-aware. It selects the relevant Buck tests for the current change set
    unless a selector or environment override asks for broader coverage.
  - Fix: use `ALL_TESTS=1 v` for a forced `//...` run, or `i && b && ALL_TESTS=1 v` for the
    full pre-merge command.
- Symptom: `i`, `b`, or `v` logs `nix cache health: disabled unreachable substituter(s)`.
  - Meaning: default `VBR_NIX_CACHE_POLICY=auto` dynamically removed unreachable configured
    HTTP(S) substituters for the current process and kept Nix fallback enabled. This is not a local
    validation failure by itself.
  - Fix: no local action is required unless you are validating remote-build or cache readiness.
    Repair the named cache endpoint, credentials, DNS, or network route before treating the cache as
    production-ready.
- Symptom: `control-plane aws-account check` records `cacheReadiness.state = "degraded"`.
  - Meaning: AWS/Supabase setup can still proceed, but at least one configured remote cache was not
    reachable from this shell.
  - Fix: inspect `buck-out/aws-account/<stack-domain>/check-tools/tools.json`; the
    `cacheReadiness.statuses` entries list the dynamic substituter identities and reachability.
- Symptom: cache readiness fails under `VBR_NIX_CACHE_POLICY=strict`.
  - Meaning: strict mode is intentionally fail-closed and should be used only when cache
    availability is the thing being tested.
  - Fix: rerun the readiness check after `nix store info --store <substituter>` succeeds for the
    listed substituters, or
    switch back to the default `auto` policy for ordinary local validation.

## Verify scope or status looks surprising

- Symptom: a docs-only change below `viberoots/build-tools/**` did not trigger full build-system scope.
  - Meaning: Markdown and reStructuredText files are scoped as documentation, not build-system
    tooling. Reviewed deployment/operator docs still run their documentation contract bucket.
  - Fix: use `ALL_TESTS=1 v` when you intentionally need full `//...` coverage.
- Symptom: `v` selected tests for files you have not committed.
  - Meaning: default scope selection unions merge-base changes with dirty worktree status from
    `git status --porcelain=v1`; untracked, renamed, deleted, and modified files all count.
  - Fix: stage/commit, clean, or intentionally leave those files present before rerunning. Use
    `v --explain-selection` when available to inspect the selected scope without running tests.
- Symptom: `l --status` or `s` shows two progress counts in the `Tests:` row.
  - Meaning: the first count is the active target pass group, and the second is total suite
    progress. JSON status exposes the same data as `group_completed`, `group_total`, `pass_index`,
    and `pass_total`.
- Symptom: status shows `GC detected: yes`.
  - Meaning: the verify log contains a Nix GC preflight warning. Treat timing from that run as
    potentially contended and rerun after stopping `nix store gc` / `nix-store --gc`.

## Duplicate/malformed patches

- Ensure one patch per `module@version`; file name must be `<encodedImport>@<version>.patch`.
- If the same module/version needs multiple edits, fold them into one patch file and keep the
  patch idempotent.

## Go import lookup errors (vendor mode)

- Symptom: `import lookup disabled by -mod=vendor` or `go.mod not found`.
- Cause: builder working directory not at module root, or vendor mode assumptions.
- Fix:
  - Ensure `viberoots/build-tools/tools/nix/lang-templates.nix` sets `pwd`/`modRoot` to the module root and `subPackages` as documented (apps: `cmd/<name>`, libs: `.`).
  - Regenerate glue and rebuild via Nix (`nix build .#graph-generator`).

## Manifest missing or empty

- Symptom: tests cannot find binaries or `manifest.json` is empty.
- Fix:
  - Run glue: `node viberoots/build-tools/tools/buck/glue-pipeline.ts` (or `node viberoots/build-tools/tools/buck/prebuild-guard.ts` in local mode).
  - Ensure `gomod2nix.toml` exists at repo root (copy from the authoritative module lock).
  - Inspect `$out/build.log` for target keys and bin discovery.

## No vendoring guard fails

- Symptom: CI test `linting_no_vendored_go` fails with `.go` files under `third_party/go`.
- Fix: remove vendored files; do not copy from `GOMODCACHE`. Third‑party is resolved by Nix and `gomod2nix.toml`.

## Node patch changes don’t seem to invalidate targets

- Ensure each Node target carries exactly one importer‑scoped lockfile label: `lockfile:<path>#<importer>` (macros enforce this).
- Place patches under the importer’s directory: `<importer>/patches/node/*.patch` (e.g., `apps/web/patches/node/…`).
- Remember: Node provider rules do not use patch paths as `srcs`; invalidation is driven by macros including the importer‑local patches in target `srcs`.
- Importer detection is automatic (the tools walk upward to the nearest `pnpm-lock.yaml`). Override explicitly with `--importer <dir>` if your layout is unusual.
- Run glue regeneration if needed: export graph → sync providers → gen auto_map, or run the prebuild guard locally to auto‑fix.

## Invalidation report (what invalidates what?)

When I’m debugging “why did this rebuild?” or “why didn’t this rebuild?”, I start with the invalidation report. It’s a deterministic, line-oriented view of each target’s patch scope, importer/lockfile metadata, whether global Nix inputs are expected as real action inputs, and the realized provider edges (as a debugging aid).

- **Where it lives**: `.viberoots/workspace/buck/invalidation-report.txt` (generated; do not hand-edit)
- **How to regenerate**:
  - `node viberoots/build-tools/tools/buck/glue-pipeline.ts` (preferred; refreshes all glue, then emits the report)
  - Or: `node viberoots/build-tools/tools/buck/invalidation-report.ts` (report-only; expects existing `graph.json` and `auto_map.bzl`)

## Exporter simulate vs authoritative

- For hermetic tests, use `--simulate`. CI uses authoritative mode.

### Prebuild guard (glue presence & freshness)

The prebuild guard verifies that generated glue files exist and are fresh relative to their inputs.

- What it checks
  - Presence: `.viberoots/workspace/buck/graph.json`, `.viberoots/workspace/providers/auto_map.bzl`, and any `.viberoots/workspace/providers/TARGETS*.auto` files (when patches or lockfiles exist).
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
  - Verbose: `node viberoots/build-tools/tools/buck/prebuild-guard.ts --verbose --verbose-limit 10`
  - JSON: `node viberoots/build-tools/tools/buck/prebuild-guard.ts --json > guard.json`

- Typical commands
  - Local auto-fix: `node viberoots/build-tools/tools/buck/prebuild-guard.ts`
  - CI sequencing: run the three glue steps explicitly before building or testing.

### Patches lint

Validate patch filenames and directory shape to prevent cache/key churn and misapplied patches.

- Rules (Go)
  - Files must be flat under `patches/go/` (no subdirectories).
  - Filenames must be `<importPath-encoded>@<version>.patch` with `/` encoded as `__`.
  - Exactly one patch per `module@version` (case-insensitive).
  - Non-`.patch` files under `patches/go/` are violations (e.g., `.gitkeep`).

- Usage
  - Advisory (default): `node viberoots/build-tools/tools/dev/patches-lint.ts`
  - Strict (CI/hooks): `node viberoots/build-tools/tools/dev/patches-lint.ts --strict`
  - JSON output: `node viberoots/build-tools/tools/dev/patches-lint.ts --format json`
  - Scope language: `node viberoots/build-tools/tools/dev/patches-lint.ts --lang go`

- Exit policy
  - Advisory: prints diagnostics and exits 0.
  - Strict: exits 1 if any violations.

### Glue regeneration (quick reference)

- Local sequence (not committed): export-graph → sync-providers → gen-auto-map.
  - Run `node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`
  - Run `node viberoots/build-tools/tools/buck/sync-providers.ts`
  - Run `node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`
  - Or run `node viberoots/build-tools/tools/dev/install-deps.ts` (dev shell) which chains them for you.
- CI sequence: the same steps as separate stages before build/test.

### Prelude-gated tests (dev shell)

- Some zx tests probe `@prelude` availability using `buck2 cquery`.
- If unavailable, the test prints a SKIP message and exits early; enter the dev shell and re-run.
- See Testing handbook for external timeouts and coverage.

### Exporter metrics (optional)

- You can ask the exporter to write a small JSON metrics file for observability.
- Usage: `node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json --metrics-out .viberoots/workspace/buck/export-metrics.json`
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
  - The deployment target has no valid `deployment_context -> controlPlane`
    selection, or an override URL disagrees with the selected control plane.
- Fix:
  - Select a deployment context with a valid control-plane profile, pass the
    admitted `--source-run-id`, and remove laptop-local artifact or records
    overrides. Use `--allow-control-plane-override --control-plane-url <url>`
    only for an intentional operator override.
  - For tests or development, use a `local_only` Vercel fixture deployment
    target instead of a protected/shared label.

## Protected/shared control-plane selection

- Operator navigation:
  - Run `deploy --deployment <label> --operator-readiness` when you need a
    concise read-only summary of the selected deployment context, selected
    control-plane profile, selected secret backend, control-plane token ref
    source, and existing AWS/Supabase/cache evidence.
  - Treat that output as a navigation aid only. It deliberately points back to
    `control-plane aws-account setup-plan`, `control-plane aws-account check`,
    and `deploy --deployment <label> --validate-only`; those commands remain
    the source of truth for fail-closed diagnostics and evidence.
  - The summary may print a `secret://...` ref or runtime environment variable
    name, but it must not print resolved token values, Vault tokens, Infisical
    client secrets, bearer headers, or backend secret payloads.
- Symptom: a protected/shared provider front door rejects before provider
  mutation with a missing control-plane, unknown `controlPlanes.<name>`,
  malformed profile, missing selected secret backend context, or unresolved
  `controlPlaneTokenRef` error.
- Likely causes:
  - The deployment target declares `deployment_context`, but the selected
    context does not contain a valid `controlPlane`.
  - A protected/shared deployment has checked-in `controlPlane` metadata but no
    real selected deployment context. For `secret://` service-token refs, the
    deployment context is the authority that selects the secret backend and
    target scope; control-plane metadata alone is not enough.
  - The context names a profile missing from `projects/config/shared.json`
    `controlPlanes`, or the profile is missing `serviceClient.controlPlaneUrl`
    or `serviceClient.controlPlaneTokenRef`.
  - The selected `serviceClient.controlPlaneTokenRef` is `secret://...`, but
    the selected deployment context does not provide an explicit secret backend
    such as Vault or Infisical.
  - The selected backend cannot build a `DeploymentSecretContext`: Vault needs
    usable `vault_runtime` metadata and operator inputs, while Infisical needs
    `infisical_runtime` metadata plus the configured Universal Auth machine
    identity or reviewed runtime credential source.
  - The selected Vault or Infisical backend is reachable, but the requested
    `secret://.../service-token` contract is missing, revoked, version-mismatched,
    or not admitted for the selected target scope.
  - `--remote <name>` was used for a command without context, but the named
    profile is absent, malformed, or its `secret://...` / `runtime://...` token
    ref cannot resolve in the current operator environment.
- Fix:
  - Add or correct `deploymentContexts.<name>.controlPlane` and the matching
    `controlPlanes.<name>.serviceClient` profile in project config.
  - Ensure protected/shared deployment targets select a real deployment context,
    not only derived `controlPlane` metadata. `secret://` control-plane tokens
    intentionally fail closed without that selected context.
  - For `secret://` service-token refs, configure the selected deployment
    context's secret backend and runtime metadata:
    - Vault: provide the reviewed `vault_runtime` configuration and the
      operator inputs required to activate a Vault-backed
      `DeploymentSecretContext`.
    - Infisical: provide the reviewed `infisical_runtime` configuration and
      the Universal Auth machine identity or reviewed runtime credential source
      expected by that runtime.
  - Verify the backend contains the exact checked-in
    `serviceClient.controlPlaneTokenRef` contract for the selected context,
    stage, and backend profile. Do not replace the ref with a plaintext token in
    shared config, local config, command output, or CLI flags.
  - For command-scoped remote selection, pass `--remote <name>` only when that
    profile exists and its token ref is resolvable. `--remote` resolves both
    the URL and token ref from the workspace root.
  - Do not expect `--control-plane-url`, `VBR_DEPLOY_CONTROL_PLANE_URL`, or
    `VBR_DEPLOY_CONTROL_PLANE_TOKEN` to rescue a protected/shared deployment
    whose selected context is missing or invalid. Those fallbacks are accepted
    only for commands without deployment context, or for an explicit reviewed
    URL override when a valid selected control plane already exists. The URL
    override still uses the selected `secret://...` or `runtime://...`
    `controlPlaneTokenRef`; raw `--control-plane-token` material remains
    rejected for context-selected protected/shared deployments.

### Control-plane service-token diagnostics

- Symptom: the error mentions
  `selected controlPlaneTokenRef ... requires a selected deployment context`,
  `requires an explicit deployment secret backend`,
  `explicit deployment secret context`, `infisical_runtime`, `vault_runtime`, or
  `required secret contract ... is missing`.
- Meaning:
  - These are fail-closed authentication checks before any provider mutation.
    They mean the selected `secret://` control-plane service token could not be
    resolved through the selected deployment context's secret backend.
  - Diagnostics may include non-secret selection metadata such as deployment
    context name, control-plane name, backend kind, token ref path, target
    scope, and whether the failure came from Vault or Infisical.
  - Resolved token values, Infisical client secrets, Vault tokens, bearer
    headers, and backend secret payloads are redacted from diagnostics,
    readonly output, and submission evidence. Seeing the `secret://...` ref is
    expected; seeing the resolved service token is a bug.
- Fix:
  - Keep `serviceClient.controlPlaneTokenRef` as `secret://...` or
    `runtime://...`.
  - For `secret://...`, repair the selected context/backend/runtime setup and
    populate the backend contract. Do not add a plaintext token fallback.
  - For `runtime://...`, repair the selected runtime-host binding or mounted
    credential source for commands that intentionally use runtime delivery.
  - Re-run the same command after the selected backend context can resolve the
    service-token contract; the provider front door should then submit using
    the selected control-plane URL and redacted selection evidence.

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
  worker profile sets `VBR_OPENTOFU_BIN` or `VBR_DEPLOY_OPENTOFU_BIN`.
- Plan or config drift appears as an OpenTofu apply mismatch in redacted
  diagnostics. Regenerate and re-admit the reviewed provisioner plan instead
  of applying from local workspace state.

## Foundation Schema Migrations

- Symptom: an approved foundation provision-only run records
  `foundationMigrationOutcome.status = "failed"`.
- Check the record's `bundleIdentity`, ordered migration list,
  `dependencyGraphFingerprint`, target Supabase identity, and redacted
  diagnostics. The worker applies the admitted PR-19 migration bundle; do not
  substitute ad hoc SQL files.
- Supabase service-role credentials must come from deployment
  `secret_requirements` at the `provision` step. Records may show the env name
  or contract ref, but the resolved service-role value must never be present.
- Post-apply failures for `rls_tenant_isolation`, `composite_tenant_fk`,
  `migration_ordering`, or `required_extension_settings` are deploy-blocking.
  Fix the schema, tenant context setup, migration ordering, or extension/settings
  posture and rerun the foundation deployment.
- If an app deployment rejects a foundation prerequisite as
  absent, stale, failed, or bound to another source revision, rerun the
  foundation migration for the same reviewed source revision or use a reviewed
  compatible migration revision.

## Coordinated Release Prerequisites

- Symptom: a coordinated release deployment rejects with
  a missing prerequisite, source-revision mismatch, or stale health evidence.
- Check the declared direct prerequisites first. Add order is
  family-specific and should be documented beside the approved deployment
  family. Staging and prod may require the same component to have advanced
  successfully through the previous lane stage.
- Downstream failures usually mean the matching prerequisite lacks fresh health
  evidence, required runtime config is not admitted, or foundation migration
  evidence is stale for the reviewed source revision.
- For non-atomic hotfixes, attach an expiring reviewed compatibility-window
  exception to the divergent run record. Do not edit source revisions or
  artifact identities in existing records.
