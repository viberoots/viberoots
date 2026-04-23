# Deployment And Secrets API

This is the comprehensive public API reference for the deployment and secrets
tools.

Most people should start with the usage guides. This document is mainly for:

- people who need the exact CLI flags
- people writing scripts or tooling against the HTTP API
- people integrating with the secrets helpers in TypeScript

Use this document when you need:

- the public `deploy` CLI surface
- the shared control-plane HTTP API and schema names
- the TypeScript helpers for `secretspec` and Vault-backed secret resolution
- short examples you can copy without reading the implementation first

Open the usage guides first when you want the shortest operator path:

- [Deployments Usage](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-usage.md)
- [Secrets Usage](/Users/kiltyj/Code/bucknix-fresh/docs/secrets-usage.md)
- [Vault Production Bootstrap Runbook](/Users/kiltyj/Code/bucknix-fresh/docs/vault-production-bootstrap.md)

## Plain-Language Glossary

- deployment service: the background HTTP service that accepts deployment
  requests and reports status
- worker: the background process that performs accepted deployment work
- `submissionId`: the ID of the request you sent to the deployment service
- `deployRunId`: the ID of the actual deployment run
- `secretspec`: the stable repo-level way to name a secret dependency without
  storing the secret value in the repo

## What Is Public And Stable

These are the public surfaces you can rely on:

1. the repo-level `deploy` CLI in
   [build-tools/tools/bin/deploy](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/bin/deploy)
2. the shared deployment service endpoints implemented by
   [nixos-shared-host-control-plane-server.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/nixos-shared-host-control-plane-server.ts)
3. the shared request and response contracts in
   [deployment-control-plane-contract.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/deployment-control-plane-contract.ts)
4. the provider submit-request contracts in
   [nixos-shared-host-control-plane-api-contract.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/nixos-shared-host-control-plane-api-contract.ts)
   and
   [cloudflare-pages-control-plane-api-contract.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/cloudflare-pages-control-plane-api-contract.ts)
5. the `secretspec` helpers in
   [deployment-secretspec.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/deployment-secretspec.ts),
   [deployment-secret-runtime.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/deployment-secret-runtime.ts),
   [deployment-secret-runtime-helpers.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/deployment-secret-runtime-helpers.ts),
   and
   [deployment-secret-vault.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/deployment-secret-vault.ts)

## `deploy` CLI

The main command-line entry point is:

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy
```

### Stable Selectors And Flags

Required selector:

- `--deployment <label>`: choose one deployment target, such as
  `//projects/deployments/pleomino-prod:deploy`

Common example values:

- `//projects/deployments/pleomino-dev:deploy`
  A shared dev deployment.
- `//projects/deployments/pleomino-staging:deploy`
  A staging deployment.
- `//projects/deployments/pleomino-prod:deploy`
  A production deployment.

Discovery and validation:

- `--list`: print the deployment targets the repo knows about
- `--validate-only`: check one deployment without changing anything
- `--print-target-identity`: print the canonical normal-flow target
  identity for one deployment
- `--from-changes`: choose one or more deployments based on changed files

Mutation and replay:

- `--artifact-dir <dir>`: optional override that names a specific built app
  folder as the client-side artifact source. For protected/shared service-backed
  runs, the reviewed client path must stage, upload, or admit that artifact on
  `mini`; the hosted service must not trust the laptop path directly.
- `--publish-only`: reuse an earlier accepted build instead of building again
- `--provision-only`: change infrastructure without publishing a new app version
- `--rollback`: tell the system you are restoring an earlier run
- `--source-run-id <deploy-run-id>`: choose the earlier run you want to reuse

Common example values and when to use them:

- `--artifact-dir ./dist`
  Typical local static-site build output.
- `--artifact-dir "$WORKSPACE/projects/apps/pleomino/dist"`
  Typical CI build output.
- `--source-run-id deploy-run-2026-04-16-abc123`
  Typical example of an earlier run ID returned by the service.
- `--publish-only --source-run-id deploy-run-2026-04-16-abc123`
  Use when you want to retry or promote an earlier run without rebuilding.
- `--publish-only --rollback --source-run-id deploy-run-2026-04-16-abc123`
  Use when you want to restore an earlier run for the same deployment.
- `--provision-only --source-run-id deploy-run-2026-04-16-abc123`
  Use when you want infrastructure-only work tied to one earlier accepted run.

Preview and target transitions:

- `--preview`: create a temporary preview from an earlier accepted run
- `--preview-cleanup`: remove preview resources for one admitted source run
- `--cleanup-reason <reason>`: explicit preview cleanup reason
- `--retire-target`: stop using one target
- `--migrate-target`: move one target to a new home
- `--target-exception-ref <label>`: the exception object used by
  `--retire-target` or `--migrate-target`

Common example values:

- `--cleanup-reason manual_cleanup`
  Use when a person is intentionally removing a preview.
- `--cleanup-reason ttl_expired`
  Use when a preview is being removed because its lifetime ended.
- `--target-exception-ref //projects/deployments/pleomino-shared:retire_old_prod_target`
  Example of a checked-in exception object for target retirement.
- `--target-exception-ref //projects/deployments/pleomino-shared:migrate_prod_pages_target`
  Example of a checked-in exception object for target migration.

Deployment-service routing:

- `--control-plane-url <url>`: the deployment service URL
- `--remote mini`: shorthand for the reviewed `mini` deployment service endpoint
- `--control-plane-token <token>`: optional bearer token for the service
- `BNX_DEPLOY_CONTROL_PLANE_URL`: environment fallback for `--control-plane-url`
- `BNX_DEPLOY_MINI_CONTROL_PLANE_URL`: optional override for `--remote mini`
- `BNX_DEPLOY_CONTROL_PLANE_TOKEN`: environment fallback used by reviewed
  service clients

Common example values:

- `--control-plane-url http://127.0.0.1:7780`
  Use only for explicit local fixture flows with
  `BNX_DEPLOY_LOCAL_FIXTURE_SERVICE=1`.
- `--control-plane-url https://deploy.apps.kilty.io`
  Use the reviewed hosted `mini` deployment service endpoint from laptops and
  automation outside the host.
- `--remote mini`
  Use the reviewed mini alias; defaults to `https://deploy.apps.kilty.io` unless
  `BNX_DEPLOY_MINI_CONTROL_PLANE_URL` is set.
- `BNX_DEPLOY_CONTROL_PLANE_TOKEN=replace-me`
  Example token environment variable for local or CI use.

Service-process configuration:

- `--control-plane-database-url <postgres-url>`: database URL for the
  deployment service or worker
- `BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL`: environment fallback for backend
  service processes and backend-native read helpers
- `BNX_DEPLOY_CONTROL_PLANE_TOKEN`: environment fallback for the deployment
  service bearer token

Common example values:

- `postgres://deployctl:REDACTED@127.0.0.1:5432/deployctl`
  Typical local Postgres connection string for the deployment service.

Vault credential-source overrides:

- `--credential-source <source>`: force `interactive_pkce`,
  `interactive_device`, `interactive_print_url`, `jenkins_client_secret`,
  `jenkins_oidc`, or `external_oidc_token`.
- `--login-browser auto|open|print|device`: override human login behavior.
  `auto` opens a browser only for local desktop sessions, avoids browser launch
  on SSH/headless sessions, and rejects interactive login in CI unless a
  reviewed override is supplied.
- `--pkce-callback-mode loopback|public_host`: force the callback profile.
- `--pkce-callback-external-scheme http|https`: browser-facing redirect scheme.
- `--pkce-callback-host <host>`: browser-facing redirect host.
- `--pkce-callback-external-port <port>`: browser-facing redirect port. Omit it
  for HTTPS reverse-proxy profiles that use the default port.
- `--pkce-callback-external-path <path>`: browser-facing redirect path.
- `--pkce-callback-bind-host <host>`: local listener bind address.
- `--pkce-callback-bind-port <port>`: stable local listener port.
- `--pkce-callback-bind-path <path>`: local listener path.
- `BNX_DEPLOYMENT_PKCE_CALLBACK_MODE`,
  `BNX_DEPLOYMENT_PKCE_CALLBACK_EXTERNAL_SCHEME`,
  `BNX_DEPLOYMENT_PKCE_CALLBACK_HOST`,
  `BNX_DEPLOYMENT_PKCE_CALLBACK_EXTERNAL_PORT`,
  `BNX_DEPLOYMENT_PKCE_CALLBACK_EXTERNAL_PATH`,
  `BNX_DEPLOYMENT_PKCE_CALLBACK_BIND_HOST`,
  `BNX_DEPLOYMENT_PKCE_CALLBACK_BIND_PORT`, and
  `BNX_DEPLOYMENT_PKCE_CALLBACK_BIND_PATH`: environment fallbacks for the same
  controls.
- `--cli-public-client-id <client-id>`: public OIDC client for human
  PKCE/device login.
- `--deployment-client-id <client-id>`: service-account client for automation.
- `--deployment-client-secret-env <env-name>`: Jenkins/client-secret source
  variable name.
- `--external-oidc-token-env <env-name>`: Jenkins/workload-identity OIDC token
  variable name.

`interactive_pkce` resolves callback configuration in this order: CLI flags,
environment variables, reviewed `vault_runtime` metadata, then loopback fallback
for local-only deploys. For protected/shared `mini` deploys, the deployment
service owns the login session and receives the browser callback at
`https://deploy-auth.apps.kilty.io/oidc/callback`; the laptop client prints or
opens the login URL and polls session status.

Deployment-service auth endpoints:

- `POST /api/v1/auth/login`
  Creates a short-lived server-owned PKCE session for a deployment/action and
  returns a non-secret `loginUrl`, `sessionId`, `redirectUri`, and expiry.
- `GET /oidc/callback`
  Receives the Keycloak redirect, exchanges the code with the same redirect URI,
  validates issuer, audience, repository, deployment environment, and any
  required human claim, then records a redacted authenticated principal.
- `GET /api/v1/auth/session?sessionId=...`
  Reports `pending`, `authenticated`, `failed`, `expired`, or `consumed` without
  exposing auth codes, PKCE verifiers, access tokens, refresh tokens, Vault
  tokens, workload JWTs, or provider credentials.

Keycloak must allowlist the external URI
`https://deploy-auth.apps.kilty.io/oidc/callback`. Local loopback listeners are
only for local-only or emergency/operator override flows that do not use the
reviewed shared service path.

### CLI Examples

List reviewed deployments:

```bash
deploy --list
```

Validate one deployment target:

```bash
deploy \
  --deployment //projects/deployments/pleomino-prod:deploy \
  --validate-only
```

Submit a normal deploy:

```bash
deploy \
  --deployment //projects/deployments/pleomino-prod:deploy
```

For a normal deploy, the CLI can usually build and resolve the artifact from
the deployment target metadata. Use `--artifact-dir` only when you want to
override that and name a specific build output folder as the artifact source.
For protected/shared service-backed runs, that folder is uploaded, staged, or
admitted through `mini` before provider mutation.

Submit a preview from an admitted run:

```bash
deploy \
  --deployment //projects/deployments/pleomino-prod:deploy \
  --preview \
  --source-run-id deploy-run-123
```

Replay an exact-artifact rollback:

```bash
deploy \
  --deployment //projects/deployments/pleomino-prod:deploy \
  --publish-only \
  --rollback \
  --source-run-id deploy-run-123
```

Use the deployment service path:

```bash
export BNX_DEPLOY_CONTROL_PLANE_URL='https://deploy.apps.kilty.io'
export BNX_DEPLOY_CONTROL_PLANE_TOKEN='replace-me'

deploy \
  --deployment //projects/deployments/pleomino-prod:deploy \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

Read the current status for one service-backed run:

```bash
deploy \
  --deployment //projects/deployments/pleomino-prod:deploy \
  --status \
  --deploy-run-id deploy-run-123 \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

Print only the exact admitted target scope string:

```bash
deploy \
  --deployment //projects/deployments/pleomino-prod:deploy \
  --print-run-lock-scope \
  --deploy-run-id deploy-run-123 \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

Approve an existing waiting run without building the JSON payload yourself:

```bash
deploy \
  --deployment //projects/deployments/pleomino-prod:deploy \
  --approve \
  --deploy-run-id deploy-run-123 \
  --approval-id ticket-123 \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

Operator helper flags:

- `--status`: print the current status JSON for one service-backed run
- `--status --text`: print a concise operator summary for one service-backed
  run, including phase, approval guidance, and admitted artifact identity when
  present
- `--record`: print the finalized provider record for one run
- `--record --text`: print a concise final record summary
- `--print-run-lock-scope`: print only the exact admitted `lockScope` value
- `--approve`: approve a `pending_approval` run using the current status
  bindings
- `--cancel-run`, `--resume-run`, `--abort-run`: submit the corresponding
  run-action through the same service path
- `--submission-id <id>` or `--deploy-run-id <id>`: select the run you want to
  inspect or act on
- `--approval-id <ref>`: required with `--approve`; use a ticket, change
  request, or similar review reference

For auth-required protected/shared service actions, the service derives the
approver or operator identity from the authenticated service session. Do not
send client-supplied `requestedBy` or authorization grants for the reviewed
shared path.

For the reviewed `nixos-shared-host` client-profile workflow, replace
`--control-plane-url ...` with `--profile mini`.

Expand from changed files:

```bash
deploy --from-changes
```

## Deployment Service HTTP API

The current service is started with:

```bash
export BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL='postgres://deployctl:REDACTED@127.0.0.1:5432/deployctl'
export BNX_DEPLOY_CONTROL_PLANE_TOKEN='replace-me'

zx-wrapper build-tools/tools/deployments/nixos-shared-host-control-plane-service.ts \
  --host 127.0.0.1 \
  --port 7780
```

The service returns JSON on all endpoints.

### Endpoints

`GET /healthz`

- returns `{ "ok": true }`

`POST /api/v1/submissions`

- accepts one submit request
- returns `deployment-control-plane-submit-response@1`

`POST /api/v1/submission-challenges/artifact`

- accepts one protected/shared artifact challenge request
- authenticates the service token before issuing a challenge
- returns `deployment-artifact-challenge@1` with `challengeId`, `nonce`,
  expiration, proof algorithm, key id, and a binding fingerprint

`GET /api/v1/status?submissionId=<id>`
`GET /api/v1/status?deployRunId=<id>`

- returns `deployment-control-plane-status@1`

`GET /api/v1/records?submissionId=<id>`
`GET /api/v1/records?deployRunId=<id>`

- returns the finalized provider record for that run

`POST /api/v1/run-actions`

- accepts one `deployment-control-plane-run-action-request@1`
- returns `deployment-control-plane-run-action-response@1`

### Schema Names

The shared schema constants are exported from
[deployment-control-plane-contract.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/deployment-control-plane-contract.ts):

- `deployment-control-plane-submit-request@1`
- `deployment-control-plane-submit-response@1`
- `deployment-control-plane-status@1`
- `deployment-control-plane-run-action-request@1`
- `deployment-control-plane-run-action-response@1`
- `deployment-control-plane-replay-selector@1`

The current provider submit schemas are:

- `nixos-shared-host-control-plane-submit-request@1`
- `cloudflare-pages-control-plane-submit-request@1`

Protected/shared `nixos-shared-host` upload submissions also carry:

- `expectedArtifactIdentity` for single-component uploads
- `expectedComponentArtifactIdentities` plus `expectedCompositeArtifactIdentity`
  for multi-component uploads
- `artifactBindingProof` with schema `deployment-artifact-binding-proof@1`
  using reviewed `hmac-sha256` proof verification

The proof binds the challenge id and nonce, deployment id and label, operation
kind, publish behavior, provider target identity, service-authenticated client
identity, proof key id, expected identity fields, source/replay selectors when
present, idempotency key, and finalized staged artifact reference. The service
first canonicalizes that reference under the configured staging root, requires
the sidecar completion marker, rejects writable entries, traversal, symlinks,
hardlinks, device files, sockets, FIFOs, and paths outside the staging root, and
then hashes and copies only from that finalized tree into the admitted store.
It then resolves an already accepted matching idempotency key, then atomically
consumes the challenge with the accepted submission, execution snapshot, and
worker queue intent. Retrying the same idempotency key, challenge, proof, and
request fingerprint returns the accepted submission; reusing the key with a
different challenge, proof, expected identity, source, staged reference, or
canonical envelope fails as an idempotency conflict. Challenge replay without
that matching accepted idempotency fingerprint fails closed. Missing, malformed,
unsupported, mismatched, expired, or replayed proof/challenge data is rejected
before provider mutation.

Accepted challenged submissions expose an `artifactBinding` summary on submit
and status responses. The summary includes the challenge id, authenticated
principal id, proof key id and algorithm, canonical envelope fingerprint,
expected identity fields, recomputed admitted identity fields, verification
decision and timestamp, and a redacted admitted artifact reference. It never
includes proof MACs, nonces, bearer tokens, or full staged artifact paths.

### Common Status Fields

The status and response contracts expose these fields:

- `submissionId`
- `deployRunId`
- `deploymentId`
- `deploymentLabel`
- `operationKind`
- `providerTargetIdentity`
- `lockScope`
- `lifecycleState`
- `terminationReason`
- `finalOutcome`
- `dedupe`
- `approval`
- `latestAction`

What they mean, with example values:

- `submissionId`
  The request ID. Example:
  `submission-2026-04-16T12:00:00Z`
- `deployRunId`
  The deployment run ID. Example:
  `deploy-run-2026-04-16-abc123`
- `deploymentId`
  The logical deployment name. Example:
  `pleomino-prod`
- `deploymentLabel`
  The repo label for the deployment. Example:
  `//projects/deployments/pleomino-prod:deploy`
- `operationKind`
  The kind of run. Examples:
  `deploy`, `promotion`, `retry`, `rollback`, `preview_cleanup`
- `providerTargetIdentity`
  The provider-specific target ID. Example:
  `nixos-shared-host:default:demoapp`
- `lockScope`
  The concurrency scope used to prevent conflicting runs. Example:
  `nixos-shared-host:default:demoapp`
- `lifecycleState`
  Where the run is right now. Examples:
  `queued`, `running`, `pending_approval`, `finished`
- `terminationReason`
  Why the run ended early, if it did. Examples:
  `cancelled`, `superseded`, or `null`
- `finalOutcome`
  The final result once the run is done. Example:
  `succeeded`
- `dedupe`
  Information about whether this exact request was newly created or reused.
- `approval`
  Approval state and binding details for runs that require human approval.
- `artifact`
  Hosted artifact-admission summary for service-backed runs, including producer
  kind and admitted artifact digest when available.
- `latestAction`
  The most recent run action, such as `cancel` or `approve`.

Important enum values:

- `lifecycleState`: `pending_approval`, `queued`, `waiting_for_lock`, `running`,
  `paused`, `cancelling`, `finished`, `cancelled`
- `approval.state`: `pending`, `granted`, `no_longer_valid`
- `run action`: `cancel`, `resume`, `abort`, `approve`

### Submit Example

Most operators should use the `deploy` CLI instead of calling this endpoint
directly. Direct submit requests are mainly for tooling and integrations.

This is a minimal example showing the shape of a
`cloudflare-pages-control-plane-submit-request@1` request after an artifact has
already been uploaded to the service:

```bash
curl \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BNX_DEPLOY_CONTROL_PLANE_TOKEN" \
  -X POST \
  https://deploy.apps.kilty.io/api/v1/submissions \
  -d '{
    "schemaVersion": "cloudflare-pages-control-plane-submit-request@1",
    "submissionId": "submission-2026-04-16T12:00:00Z",
    "submittedAt": "2026-04-16T12:00:00Z",
    "deployment": {
      "deploymentId": "pleomino-staging",
      "label": "//projects/deployments/pleomino-staging:deploy",
      "provider": "cloudflare-pages"
    },
    "operationKind": "deploy",
    "artifactInput": {
      "kind": "client_upload",
      "uploadSessionId": "upload-2026-04-16T12:00:00Z",
      "sourceRevision": "7d3f2c1",
      "deploymentLabel": "//projects/deployments/pleomino-staging:deploy",
      "buildTarget": "//projects/apps/pleomino:app"
    }
  }'
```

For protected/shared `cloudflare-pages`, direct `artifactDir` values are not a
valid service submission. The supported artifact-input producer modes are
`server_build`, `client_upload`, `ci_attested`, and
`existing_admitted_artifact`.

Typical response shape:

```json
{
  "schemaVersion": "deployment-control-plane-submit-response@1",
  "submissionId": "submission-2026-04-16T12:00:00Z",
  "deploymentId": "demoapp-dev",
  "deploymentLabel": "//projects/deployments/demoapp-dev:deploy",
  "operationKind": "deploy",
  "providerTargetIdentity": "nixos-shared-host:default:demoapp",
  "lockScope": "nixos-shared-host:default:demoapp",
  "lifecycleState": "queued",
  "terminationReason": null,
  "dedupe": {
    "mode": "created",
    "requestFingerprint": "sha256:example"
  }
}
```

What the example values mean:

- `submissionId = "submission-2026-04-16T12:00:00Z"`
  The request ID you use for status or record lookups.
- `deploymentId = "demoapp-dev"`
  The logical name of the deployment.
- `deploymentLabel = "//projects/deployments/demoapp-dev:deploy"`
  The checked-in repo label used to select the deployment.
- `operationKind = "deploy"`
  A normal deployment run rather than a preview, retry, or rollback.
- `providerTargetIdentity = "nixos-shared-host:default:demoapp"`
  The concrete target identity on the backend.
- `lifecycleState = "queued"`
  The service accepted the request and is waiting to start work.

### Status And Record Examples

Read status by `submissionId`:

```bash
curl \
  -H "Authorization: Bearer $BNX_DEPLOY_CONTROL_PLANE_TOKEN" \
  'https://deploy.apps.kilty.io/api/v1/status?submissionId=submission-2026-04-16T12:00:00Z'
```

Read the finalized record by `deployRunId`:

```bash
curl \
  -H "Authorization: Bearer $BNX_DEPLOY_CONTROL_PLANE_TOKEN" \
  'https://deploy.apps.kilty.io/api/v1/records?deployRunId=deploy-run-123'
```

Use `submissionId` when you want to follow the exact request you submitted. Use
`deployRunId` when you are tracking the actual run as it moves through approval,
execution, and finalization.

### Run-Action Example

Approve an existing `pending_approval` run instead of resubmitting it:

```bash
curl \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BNX_DEPLOY_CONTROL_PLANE_TOKEN" \
  -X POST \
  https://deploy.apps.kilty.io/api/v1/run-actions \
  -d '{
    "schemaVersion": "deployment-control-plane-run-action-request@1",
    "actionId": "approve-2026-04-16T12:05:00Z",
    "submittedAt": "2026-04-16T12:05:00Z",
    "submissionId": "submission-2026-04-16T12:00:00Z",
    "action": "approve",
    "approval": {
      "approvalId": "ticket-123",
      "expectedPayloadFingerprint": "sha256:payload-from-status",
      "expectedTargetIdentity": "nixos-shared-host:default:demoapp",
      "expectedProvisionerPlanFingerprint": "sha256:plan-from-status"
    }
  }'
```

What the approval fields mean:

- `actionId = "approve-2026-04-16T12:05:00Z"`
  A unique ID for this approval action request.
- `submissionId = "submission-2026-04-16T12:00:00Z"`
  The already-existing request you are approving.
- `approvalId = "ticket-123"`
  A human review reference such as a ticket, incident, or approval record.
- `expectedPayloadFingerprint = "sha256:payload-from-status"`
  The payload hash you reviewed from the status response.
- `expectedTargetIdentity = "nixos-shared-host:default:demoapp"`
  The exact deployment target you intend to approve.
- `expectedProvisionerPlanFingerprint = "sha256:plan-from-status"`
  The infrastructure plan hash you reviewed when provisioning is in scope.

Cancel a queued run:

```bash
curl \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BNX_DEPLOY_CONTROL_PLANE_TOKEN" \
  -X POST \
  https://deploy.apps.kilty.io/api/v1/run-actions \
  -d '{
    "schemaVersion": "deployment-control-plane-run-action-request@1",
    "actionId": "cancel-queued-1",
    "submittedAt": "2026-04-16T12:06:00Z",
    "submissionId": "submission-2026-04-16T12:00:00Z",
    "action": "cancel",
    "idempotencyKey": "cancel-queued-1"
  }'
```

## `secretspec` And Vault Runtime APIs

The `secretspec` layer is the stable public surface. It lets callers name the
secret they need without caring about the backend details. Vault is the current
backend behind that surface.

### Public Types And Helpers

The public `secretspec` helpers are exported from
[deployment-secretspec.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/deployment-secretspec.ts):

- `DeploymentSecretBackendKind`
- `DeploymentSecretContractBinding`
- `deploymentSecretContractBindings()`
- `deploymentSecretBindingsForStep()`

The runtime helpers are exported from
[deployment-secret-runtime.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/deployment-secret-runtime.ts):

- `DeploymentSecretMaterial`
- `DeploymentSecretBackend`
- `createDeploymentSecretRuntime()`

The Vault-backed helpers are exported from:

- `createDeploymentVaultSecretBackend()` in
  [deployment-secret-vault.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/deployment-secret-vault.ts)
- `createVaultDeploymentSecretRuntime()` in
  [deployment-secret-runtime-helpers.ts](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/deployments/deployment-secret-runtime-helpers.ts)

### Requirement Shape

Secret requirements are declared as deployment requirements with a step and a
contract ID:

```ts
const requirements = [
  {
    name: "cloudflare_api_token",
    step: "publish",
    contractId: "secret://deployments/pleomino/cloudflare_api_token",
    required: true,
  },
];
```

Field meanings with example values:

- `name: "cloudflare_api_token"`
  A short local name used by the deployment code at runtime.
- `step: "publish"`
  Use `publish` when the secret is needed to send a release to a provider.
- `step: "preview_cleanup"`
  Use `preview_cleanup` when the secret is needed for a destructive provider
  preview cleanup operation.
- `step: "provision"`
  Use `provision` when the secret is needed only for infrastructure work.
- `step: "smoke"`
  Use `smoke` when the secret is needed only for post-deploy verification.
- `step: "release_actions.pre_publish"`
  Use this when a custom pre-publish action needs the secret.
- `contractId: "secret://deployments/pleomino/cloudflare_api_token"`
  The stable repo-level secret name; keep this stable even when the value
  rotates.
- `required: true`
  Use `true` when the deployment must fail if the secret is missing.
- `required: false`
  Use `false` only for optional behavior such as an authenticated smoke check
  that can be skipped.

The binding helpers turn those requirements into a backend-independent list of
secret bindings:

```ts
import {
  deploymentSecretContractBindings,
  deploymentSecretBindingsForStep,
} from "./build-tools/tools/deployments/deployment-secretspec.ts";

const bindings = deploymentSecretContractBindings(requirements);
const publishBindings = deploymentSecretBindingsForStep(bindings, "publish");
const cleanupBindings = deploymentSecretBindingsForStep(bindings, "preview_cleanup");
```

In this example:

- `deploymentSecretContractBindings(requirements)` converts the raw deployment
  requirements into a normalized secret-binding list.
- `deploymentSecretBindingsForStep(bindings, "publish")` filters that list down
  to only the secrets allowed during the `publish` step.
- `deploymentSecretBindingsForStep(bindings, "preview_cleanup")` filters that
  list down to cleanup-only provider credentials.

### Runtime Example

Resolve only the secrets needed for the current step:

```ts
import { createDeploymentSecretRuntime } from "./build-tools/tools/deployments/deployment-secret-runtime.ts";
import { createDeploymentVaultSecretBackend } from "./build-tools/tools/deployments/deployment-secret-vault.ts";

const runtime = createDeploymentSecretRuntime({
  backend: createDeploymentVaultSecretBackend(secretContext),
  requirements,
  targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
});

const publishSecrets = await runtime.enterStep("publish");
console.log(publishSecrets.cloudflare_api_token);
```

What the example values mean:

- `targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages"`
  The specific deployment target that is allowed to use the secret. In normal
  deploy flows, this should be the admitted `targetEnvironment.lockScope`
  value.
- `runtime.enterStep("publish")`
  Ask the runtime for only the secrets needed while publishing.
- `publishSecrets.cloudflare_api_token`
  Read the secret value by the local `name` from the requirement entry.

Use the convenience helper when you already have deployment context available:

```ts
import { createVaultDeploymentSecretRuntime } from "./build-tools/tools/deployments/deployment-secret-runtime-helpers.ts";

const runtime = createVaultDeploymentSecretRuntime({
  secretContext,
  admittedContext: {
    secretRequirements: requirements,
    targetEnvironment: {
      lockScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    },
  },
});
```

Use the convenience helper when your code already has admitted deployment
context and you do not want to wire the backend, requirements, and target scope
by hand.

Where the target scope comes from:

- `createVaultDeploymentSecretRuntime()` reads
  `admittedContext.targetEnvironment.lockScope`
- `createDeploymentSecretRuntime()` checks each secret's `targetScopes` against
  that runtime `targetScope`
- in normal deploy flows, `lockScope` is set during admission and is usually the
  same as `targetEnvironment.providerTargetIdentity`

That means operators should use the deployment's admitted `lockScope` value as
the source of truth when populating `targetScopes`.

### Secret Fixture Example

The reviewed production path points `createDeploymentVaultSecretBackend()` at an
explicit in-memory deployment secret context backed by remote Vault JWT
authentication:

```python
vault_runtime = {
    "addr": "https://vault.example.net:8200",
    "oidc_issuer": "https://identity.example.net/realms/deployments",
    "audience": "deployments-vault",
    "cli_public_client_id": "deployment-cli",
    "service_account_client_id": "deployment-runner",
    "deployment_environment": "runner-prod",
    "preferred_credential_source": "jenkins_client_secret",
    "jenkins_client_secret_env": "JENKINS_DEPLOYMENT_CLIENT_SECRET",
}
```

Keep Jenkins-bound client secrets and external OIDC tokens outside the repo.
They are read only by the deploy front-door credential-source adapter, then
converted into the explicit in-memory Vault credential context. For local human
deploys, set `preferred_credential_source = "interactive_pkce"` or leave
selection on auto so the CLI uses a public PKCE client on desktop terminals and
device/print-only behavior on SSH/headless sessions.

Local/direct deploys derive the Vault role and bound claims from the selected
deployment and its `vault_runtime` metadata, then create a typed context containing the Vault address.
Protected service-backed deploys use a different boundary: the submitter's PKCE/device session
authorizes the request, while the `mini` worker reads non-secret Vault runtime metadata from the
execution snapshot and obtains a server-local workload credential immediately
before provider execution. The workload JWT and returned Vault token stay in
worker memory for the deployment run; normal deploys do not write JWT files or
set `BNX_VAULT_JWT`, `BNX_VAULT_JWT_FILE`, `BNX_VAULT_AUTH_METHOD`,
`BNX_VAULT_JWT_ROLE`, or `VAULT_TOKEN` in `process.env`.

Local development, isolated tests, and explicit bootstrap-oriented workflows
can intentionally override the local/direct runtime path with the reviewed
fixture file. Protected service-backed workers reject this override:

```bash
export BNX_DEPLOYMENT_SECRET_FIXTURE_PATH="$PWD/secret-fixture.json"
```

Production operators should also read
[Vault Production Bootstrap Runbook](/Users/kiltyj/Code/bucknix-fresh/docs/vault-production-bootstrap.md).
That runbook bootstraps Vault as the source of truth for the JWT-first runtime
path and also shows how to export this fixture format for local/test workflows.

Example fixture:

```json
{
  "schemaVersion": "deployment-secret-fixture@1",
  "contracts": {
    "secret://deployments/pleomino/cloudflare_api_token": {
      "value": "super-secret-token",
      "allowedSteps": ["publish"],
      "targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
      "refreshMode": "renew",
      "credentialClass": "routine"
    }
  }
}
```

What the common fixture fields mean:

- `"value": "super-secret-token"`
  The actual secret value returned to the runtime.
- `"allowedSteps": ["publish"]`
  Use this for a provider credential that should be available only during the
  publish step.
- `"allowedSteps": ["preview_cleanup"]`
  Use this for a provider credential that should be available only while
  deleting preview resources.
- `"allowedSteps": ["smoke"]`
  Use this for a credential that should be available only during smoke checks.
- `"targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"]`
  The exact deployment target allowed to use this contract. This should match
  the deployment's admitted `lockScope`.
- `"refreshMode": "renew"`
  Use this when the backend should refresh the same credential in place.
- `"refreshMode": "reacquire"`
  Use this when the backend should fetch a new credential instead of renewing.
- `"credentialClass": "routine"`
  Standard day-to-day deployment credential.
- `"credentialClass": "break_glass"`
  Emergency-only credential that normal flows should not consume.

How to get the right `targetScopes` value:

1. first-time setup:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-target-identity
```

For normal deploys, that value is the right starting point for `targetScopes`.

2. exact run verification:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-run-lock-scope \
  --deploy-run-id "$DEPLOY_RUN_ID" \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

Use that `lockScope` value as the source of truth for the exact run.

3. precedence rule:

- if you only need the normal deploy target before the first run, the
  `--validate-only` output is enough
- if a run already exists, or if you are doing preview, cleanup, retry,
  rollback, promotion, or another special flow, prefer the exact `lockScope`
  returned by the status API

Common admitted shapes by backend:

- Cloudflare Pages:
  `cloudflare-pages:<account>/<project>`
- `nixos-shared-host`:
  `nixos-shared-host:<target-group>:<app>`
- S3 static:
  `s3-static:<account>/<bucket>`
- Kubernetes:
  `kubernetes:<cluster>/<namespace>/<release>`
- App Store Connect:
  `app-store-connect:<issuer>/<app>#track:<track>`
- Google Play:
  `google-play:<developer-account>/<app>#track:<track>`

Copyable example:

```json
"targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"]
```

### Secret Runtime Rules

The runtime contract is intentionally narrow:

- `enterStep(step)` resolves only the secrets needed for that lifecycle step
- initial admission freezes `admittedSecretReferences` with the exact non-secret
  Vault selector information needed for replay-safe runtime fetches
- `secretspec` stays the contract layer, admitted secret references stay the
  replay/runtime layer, Vault stays the production backend, and the secret
  fixture stays the local/test override format
- required contracts fail when missing, revoked, expired, or no longer
  refreshable
- routine flows cannot consume `break_glass` credentials
- records and replay snapshots preserve secret references, not secret values

### Auth Diagnostic APIs

The public deploy front door exposes a read-only auth group:

- `deploy auth doctor --deployment <label>`
  Reports the selected credential source, selection reason, Vault runtime
  metadata, missing required setup, and memory-only session policy.
- `deploy auth explain-vault-role --deployment <label>`
  Reports issuer, audience, Vault address, role name, generated policy name,
  and bound claim keys for the deployment's Vault JWT role.
- `deploy auth print-login --deployment <label>`
  Prints browserless PKCE/device-flow guidance for SSH and headless operators.
- `deploy auth print-jenkins-help --deployment <label>`
  Prints Jenkins Secret Text/OIDC binding guidance for the selected deployment.
- `deploy auth credential-source-matrix --deployment <label>`
  Emits the shared credential-source matrix used by CLI help and docs parity
  tests.

All auth diagnostic commands are non-mutating. They do not mint tokens, exchange
Vault credentials, read deployment secret values, write repo-local cache files,
or call provider mutation APIs.

Auth diagnostic output uses the shared deployment auth redaction policy. It
redacts OIDC access tokens, refresh tokens, auth codes, PKCE verifiers, device
codes, client secrets, Vault JWTs, Vault tokens, and Jenkins-bound secret values.
It may print non-secret routing metadata such as issuer URL, Vault address,
audience, role name, policy name, claim names, and verification instructions.

The current repo-level diagnostic session/cache product policy is explicit:
interactive login material is memory-only for the deploy process. Shared
deployment service auth sessions are separate short-lived server records: they
persist only state, nonce, PKCE verifier, requested action metadata, redacted
principal, and authorization evidence, and never persist token material. There
is still no repo-local `deploy auth status` or `deploy auth logout` command.

## When To Open Which Doc

Open [Deployments Usage](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-usage.md)
when you want the fastest operator command path.

Open [Secrets Usage](/Users/kiltyj/Code/bucknix-fresh/docs/secrets-usage.md)
when you need the shortest explanation of the `secretspec` and Vault model.

Open [Vault Production Bootstrap Runbook](/Users/kiltyj/Code/bucknix-fresh/docs/vault-production-bootstrap.md)
when you need the operator workflow for initializing Vault, enabling KV/JWT auth,
writing policies, storing secrets, and exporting the current secret fixture.

Open [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
when you need the architectural rationale behind the API surface.

Open [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
when you need the fail-closed behavioral rules that the public APIs must obey.
