# 10. Vercel Deployment Provider

**Tier:** Core Providers + Auth
**Priority:** 10 of 44
**Depends on:** #4 Containerize Control Plane, #9 Vercel Build Target
**Estimated effort:** L
**Date:** 2026-05-25
**Summary:** Cut the first live protected/shared Vercel deployment by creating a deployment package under `projects/deployments/`, provisioning real provider credentials, and validating the end-to-end admission-to-publish flow.

## What

Wire the existing Vercel provider implementation into a live, admission-gated deployment path
that publishes repo-built `.vercel/output` artifacts through the Vercel Build Output API and
records complete, auditable deploy runs.

The implementation surface that exists today is substantial and covers the full provider lifecycle:

- **Contract types and provider target** — `VercelDeployment`, `VercelProviderTarget`,
  `deriveVercelProviderTarget` (`vercel-provider-target.ts`). Canonical identity is
  `vercel:<team>/<project>#<environment>`.
- **Capability registry entry** — `VERCEL_PROVIDER_CAPABILITY` in
  `provider-capabilities/vercel.ts`, reviewed for `ssr-webapp` only, `all_at_once` rollout,
  `vercel-prebuilt` publisher, Git auto-build explicitly rejected, protected/shared eligibility
  declared via control-plane routing.
- **Starlark macro** — `vercel_next_webapp_deployment` in `build-tools/deployments/vercel_defs.bzl`.
  Emits `component_kind = "ssr-webapp"`, requires shared policy for non-`local_only` protection
  classes, and defaults to `publisher = "vercel-prebuilt"` with `vercel-prebuilt.jsonc` as the
  checked-in publisher config.
- **Publisher config preparation** — `prepareVercelPublisherConfig` (`vercel-config.ts`). Reads
  `vercel-prebuilt.jsonc`, cross-checks `team`, `project`, and `environment` against `TARGETS`,
  hard-rejects `mode: git-autobuild`, forces `mode: prebuilt` in the rendered output, and
  fingerprints the config.
- **Admission** — `vercel-admission.ts` exposes `resolveInitialVercelAdmittedContext` and
  `resolveSourceRunVercelAdmittedContext`, following the same two-stage source + target-environment
  admission shape used by `cloudflare-pages`.
- **Artifact admission** — `vercel-artifacts.ts` with `admitVercelPrebuiltArtifact` and
  `requireAdmittedVercelArtifactPath`. Resolves the artifact directory and reads `artifact-identity.json`.
- **Live and fake API clients** — `vercel-api.ts`. `createFakeVercelApiClient` produces deterministic
  release IDs and URLs keyed on target + artifact identity. `createLiveVercelApiClient` calls the
  Vercel REST API with configurable poll attempts and poll interval, uploads output files, polls for
  a determinate deployment status, and assigns aliases.
- **Publisher** — `publishVercelPrebuilt` and `cleanupVercelPreview` (`vercel-publisher.ts`). Selects
  live vs. fake client from `protectionClass` and publisher config, calls `publishPrebuilt`, resolves
  the alias from `canonicalUrl`, and returns `providerReleaseId`, `publicUrl`, and `aliasAssigned`.
- **Deploy orchestration** — `submitVercelDeploy` and `submitVercelPreviewCleanup` (`vercel-deploy.ts`).
  Admits the artifact, enters the secret runtime at the `publish` step to obtain `vercel_api_token`,
  publishes, runs smoke, writes a replay snapshot, and creates and writes a `VercelDeployRecord`.
- **Exact-artifact replay** — `submitVercelExactArtifactRun` (`vercel-exact-run.ts`). Executes retry,
  rollback, and promotion using only the recorded replay snapshot; never rebuilds from branch state.
- **Smoke** — `smokeVercelConsole` (`vercel-smoke.ts`). Checks the public URL for a non-error HTTP
  response, verifies an app shell marker and optional `consoleToWebBaseUrl` string, and confirms the
  configured auth route.
- **Front door** — `runVercelDeployFrontDoor` and `runVercelDeployFrontDoorForCli` (`vercel-front-door.ts`).
  Dispatches to the protected front door when the deployment is non-`local_only` and a control-plane
  URL is configured; handles `deploy`, `preview`, `preview_cleanup`, `--publish-only`, and `--rollback`.
- **Protected front door** — `runProtectedVercelDeployFrontDoor` (`vercel-protected-front-door.ts`).
  Rejects local artifact paths for protected/shared deployments, resolves the expected source
  revision, builds the admission evidence, and submits a `VercelControlPlaneSubmitRequest` to the
  control-plane service.
- **Control-plane execution** — `queueVercelControlPlaneSubmission` and
  `executeVercelControlPlaneSubmission` (`vercel-control-plane.ts`). Builds a frozen provider
  snapshot, acquires the backend lock, runs the operation under `withFrozenProviderWorkerSecretRuntime`,
  and writes the result record. Dispatches to `submitVercelDeploy`, `submitVercelPreviewCleanup`, or
  `submitVercelExactArtifactRun` based on `operationKind`.
- **Records** — `vercel-records.ts`, `vercel-record-diagnostics.ts`, `vercel-replay.ts`.
  Record schema covers `deployRunId`, `operationKind`, `finalOutcome`, artifact identity, provider
  release ID, public URL, alias assignment, source run ID, replay snapshot path, and admitted context.
- **Docs** — `deployments-schema.md` documents the `vercel` provider target shape;
  `deployment-provider-capabilities.md` renders the capability entry; `deployments-usage.md`
  covers the `vercel` TARGETS section, live Vercel setup, and protected/shared control-plane examples.
- **CLI dispatch** — `deploy-cli-provider-dispatch.ts` dispatches `provider === "vercel"` to
  `runVercelDeployFrontDoorForCli`.
- **Tests** — fifteen test files covering contract extraction, validation, local publisher,
  live publisher, API failures, poll-context handling, front-door routing, CLI–service handoff,
  control-plane execution, live records, live poll records, frozen provider replay, and fixture helpers.

What is missing and must be built to close the provider:

1. **A real `projects/deployments/` package using the Vercel provider.** No deployment package
   under `projects/deployments/` currently declares `provider = "vercel"`. The `example-console`
   app has a placeholder `vercel_artifact` Buck target in `projects/apps/example-console/TARGETS`
   (a `genrule` that writes a stub `.vercel/output`), but no corresponding deployment package
   exists. A first deployment package is needed to exercise the full admission, publish, and record
   path in a real Buck context. Until this exists, the provider is untested end-to-end outside of
   unit fixtures.

2. **A real Next.js Vercel Build Output API artifact target (task #9).** The current
   `example-console` artifact is a stub `genrule`. A real hermetic artifact target is required
   before the publisher can admit and upload meaningful output. Task #9 produces this target; task
   #10 is blocked on it.

3. **Wiring of the `scaf` deployment scaffolder to `vercel_next_webapp_deployment`.** The usage doc
   shows a `scaf new deployment` invocation, but the scaffolder's wiring to the Vercel macro has
   not been confirmed against the current scaffold implementation.

4. **Credential provisioning.** A real `vercel_api_token` secret must be stored in the reviewed
   Infisical/Infisical path and declared in `secret_requirements` for the first real deployment.
   The live API client accepts the token through the secret runtime; the integration tests today
   use fake or configurable base-URL fixtures.

5. **DNS and alias assignment.** The `canonicalUrl` field in `VercelProviderTarget` drives alias
   assignment after publish. A real deployment requires DNS/domain ownership to be configured in
   Vercel and verified before the first live protected/shared run.

6. **Capability entry `supportsProtectedShared: false` for release actions.** The entry currently
   sets `releaseActions.supportsProtectedShared = false`. If the console deployment needs release
   actions in the future, this must be updated with a separate reviewed capability change.

## Why Now

The Vercel provider is priority 8 because the implementation surface is already substantially
complete — the incremental cost is low relative to the value unlocked. The cloudflare-pages provider
is the reference implementation; the Vercel provider follows the same admission, artifact, secret
runtime, replay, and control-plane patterns, all of which are already implemented and tested for
the Vercel case.

This task is blocked on #9 (Vercel build target) because publishing a real `.vercel/output` artifact
requires a hermetic Buck/Nix target that produces it. It is also blocked on #4 (containerize control
plane) because protected/shared Vercel mutations route through the control-plane service, and that
service must be running in a container before the protected front door can submit real requests.

Without this task, any Vercel-hosted app — including the control-plane webapp if it is deployed to
Vercel — is limited to either Vercel Git auto-builds (explicitly out of policy as the authoritative
protected/shared production path) or ad-hoc local publishes outside the repo's admission model.
The console is the immediate first target.

## Risks

- **Stub artifact in place of a real build.** The `example-console` placeholder `genrule`
  produces a stub `.vercel/output`. Promoting the deployment to `shared_nonprod` before task #9
  delivers a real Next.js artifact would exercise the publish path but deploy meaningless content.
  The real risk is that a stub deploy could be mistaken for a real console in non-prod environments.
  Gate the first `shared_nonprod` run on task #9 being complete.

- **Vercel Build Output API version coupling.** The live API client in `vercel-live-api-helpers.ts`
  reads output files from `.vercel/output/static` and `functions` directories using the Build Output
  API v3 shape. If Vercel changes the API contract or the CLI version used for the artifact build
  emits a v4 shape, the publisher will fail or upload incorrectly. Pin the Build Output API version
  and add a negative test that rejects artifacts that do not conform to the expected output contract.

- **Poll-based deployment readiness.** The live API client polls Vercel's deployment status up to
  `pollAttempts` times (default 60) at `pollIntervalMs` intervals (default configurable). If
  Vercel's deployment pipeline is slow or the API is eventually consistent, the publisher can time
  out and produce an `ambiguous` outcome. Ambiguous outcomes fail closed and write a failure record
  but leave a potentially live deployment with no alias assignment. Ensure the control-plane
  submission includes a way to detect and resolve these orphaned deployments.

- **Alias assignment side effects.** After a successful publish, `assignVercelAliases` calls the
  Vercel API to assign the `canonicalUrl` hostname as an alias. If alias assignment fails after
  publish succeeds, the record still writes `aliasAssigned: false`. A subsequent retry would publish
  a new deployment rather than just retrying the alias assignment. Clarify whether alias-only
  retries should be a separate operation or whether the existing retry path is sufficient.

- **Preview cleanup ambiguity.** `submitVercelPreviewCleanup` hard-rejects any cleanup response
  with `cleaned: false` or a blank `deploymentId` as an ambiguous outcome. The Vercel API may
  return this for a deployment that was already cleaned, causing spurious failure records. Add a
  fixture test covering the idempotent cleanup case.

## Trade-offs

- **Live API client vs. Wrangler CLI.** Unlike the `cloudflare-pages` provider, which uses the
  `wrangler pages deploy` CLI command, the Vercel provider calls the Vercel REST API directly
  through `vercel-live-api-helpers.ts`. This is more testable (the base URL and poll parameters
  are configurable) but requires maintaining the API client as Vercel's upload and deployment APIs
  evolve. The direct API path was chosen to avoid coupling the publish step to the Vercel CLI's
  ambient home-directory and global `.vercel` state.

- **Fake client gated to `local_only`.** `createFakeVercelApiClient` is allowed only when
  `protectionClass === "local_only"`. This is intentional and matches the policy that
  `shared_nonprod` and `production_facing` deployments must use the live API. The downside is that
  integration testing for the `shared_nonprod` path requires either a live Vercel account or a
  fake API server at a configurable `apiBaseUrl`. The existing tests use the latter pattern via
  `vercel.control-plane.helpers.ts`.

- **Single `ssr-webapp` component kind.** `VERCEL_PROVIDER_CAPABILITY` explicitly excludes static
  webapps and multi-component deployments. This matches the intent of the initial slice but means
  static PWAs cannot use the Vercel provider without a reviewed capability update. If a future app
  needs static hosting on Vercel, a separate capability review is required rather than a simple
  config change.

- **Provider-native config as validated input, not a second source of truth.** `vercel-prebuilt.jsonc`
  is cross-checked against `TARGETS` at publish time: mismatches in `team`, `project`, or
  `environment` throw hard errors. The config's `mode` field is overwritten to `prebuilt` in the
  rendered output regardless of what it declares, and `git-autobuild` is rejected outright. This
  is consistent with the ADR-00002 invariant but means operators cannot use a single
  `vercel-prebuilt.jsonc` across multiple deployment IDs — each deployment package needs its own.

## Considerations

- The `vercel-prebuilt.jsonc` publisher config supports an `api` object with `mode`, `baseUrl`,
  `pollAttempts`, and `pollIntervalMs` fields. These are the integration-test escape hatches used
  by `vercel.control-plane.helpers.ts`. Production deployment packages should not set `api.mode`
  or `api.baseUrl`; their absence defaults to the live client. Validate that no production package
  accidentally sets `api.mode: fake`.

- The `VercelControlPlaneSnapshot` frozen at queue time carries the full `deployment` object,
  `operationKind`, `artifactDir`, `admittedContext`, `replaySource`, and `smokeConnectOverride`.
  The control-plane worker validates the snapshot's `provider` field matches `"vercel"` before
  executing. Any mismatch causes `requireFrozenProviderSnapshot` to throw. Ensure that the
  snapshot version and shape are kept in sync with `vercel-control-plane-snapshot.ts` when the
  control-plane image is updated.

- The `deploy-cli-provider-dispatch.ts` entry for Vercel passes `publishOnly`, `preview`,
  `previewCleanup`, `rollback`, `sourceRunId`, `artifactDirFlag`, `admissionEvidence`, and
  `smokeConnectOverride` to `runVercelDeployFrontDoorForCli`. This is already the full flag set;
  no missing flags need to be added when the live path is exercised, unlike the
  `cloudflare-containers` case.

- The `deployment-admission-vercel-boundary.ts` file provides a boundary-level admission check.
  Confirm this is invoked in the protected front door path and that its errors surface before any
  artifact upload or API call is made.

- `deployments-usage.md` already documents the minimum live Vercel setup: a `publish`-step
  `vercel_api_token` secret requirement, the `vercel:<team>/<project>#<environment>` provider
  target identity, a `vercel-prebuilt.jsonc` with `mode = prebuilt`, and DNS/domain ownership
  verification before the first run. Confirm this against the first real deployment package when
  it is created.

- The control-plane webapp itself is a candidate for the first real Vercel deployment package,
  given that `docs/control-plane-web-ui.md` exists and the console is the stated immediate target.
  If that app becomes the first real deployment, the deployment package should live under
  `projects/deployments/` alongside the existing `sample-webapp` deployments and use
  `vercel_next_webapp_deployment` from `vercel_defs.bzl`.
