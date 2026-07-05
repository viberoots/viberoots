# Deployments Usage

This is the main starting point for day-to-day deployment work.

You do not need to know the implementation details of the deployment system to
use this guide.

Use this guide when you want the shortest path to the day-to-day workflows:

- pick the right deployment target
- run the reviewed repo-level `deploy` front door
- choose the right operation mode for deploy, preview, retry, rollback,
  promotion, provision-only, or target transition
- understand which provider family docs to open next

Use the deeper docs when needed:

- [Deployments Design](history/designs/deployments-design.md)
  for model rationale, authoring structure, and policy intent
- [Deployment Contract](deployments-contract.md)
  for fail-closed shared operator and implementation guarantees
- [Deployment And Secrets API](deployment-secrets-api.md)
  for the public CLI, control-plane, and `SprinkleRef` helper surface
- [Secrets Usage](secrets-usage.md)
  for declaring deployment secret requirements and choosing the Vault or
  Infisical workflow per deployment
- [Deployment Provider Capabilities](deployment-provider-capabilities.md)
  for reviewed provider-specific support and constraints
- [Deployment Scenarios](deployment-scenarios.md)
  for canonical scenario-by-scenario expectations
- [NixOS Shared Host Usage](nixos-shared-host-usage.md)
  for the reviewed `mini` host workflow and the start-here path for first-time
  `mini` setup
- [Runtime Prefix Migration](history/migrations/runtime-prefix-migration.md)
  for updating old runtime environment variables to `VBR_*`

## Main Command

The public repo-level entrypoint is:

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy
```

Use `--deployment <label>` to choose what you want to deploy.

If you are new to this repo, you can think of the label as the deployment's
unique name inside the repo. Example:

- `//projects/deployments/example-app/prod:deploy`

## Plain-Language Glossary

- deployment label: the unique name of a deployment in this repo
- deploy run id: the ID of one previous deployment run; you use this when you
  want to reuse or inspect an older run
- preview: publish a temporary copy without replacing the normal live target
- rollback: move one deployment back to an earlier successful version
- promotion: take an earlier successful run and publish it to a different
  deployment target, such as `staging` to `prod`
- provision-only: create or update infrastructure without publishing a new app
  version
- provider family: the deployment backend for a target, such as
  `nixos-shared-host`, `cloudflare-pages`, or `kubernetes`
- pending approval: the system accepted the run, but it is waiting for a person
  to approve it before it continues

## Core Workflows

Normal deploy:

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy
```

For a normal deploy, this is usually enough. The deployment definition tells
the CLI which app target to build, and the CLI resolves the artifact from that
target automatically. The same repo-level front door also enforces declared
readiness gates and rejects app targets that import other app targets before a
provider-specific mutation runs.

Phase 0 readiness evidence is access-mode aware. Use
`accessMode: "direct_upload_pilot"` when admission should require only Gates 1-4,
and `accessMode: "connector_demo"` when Connect and GitHub external-source
evidence must also pass. Connector evidence is source-specific for Drive,
Notion, Slack, and GitHub, and WorkOS MCP evidence is client-specific for the
reviewed clients. Connector evidence is only an evidence reference, redacted
summary, and redacted diagnostics; live service credentials are resolved by the
reviewed secret-runtime steps, not stored in CI variables or deployment records.

Deployments that run server-side GitHub App code should use the shared
`github_app_requirements(...)` helper instead of hand-writing the platform app
credential declarations. Web deployments can opt into webhook material while
workers can declare only the app private key and app id:

```starlark
nixos_shared_host_ssr_webapp_deployment(
    name = "deploy",
    component = "//projects/apps/example-web:app",
    **github_app_requirements(
        "example-web-staging",
        webhooks = True,
        webhook_config = True,
    )
)

kubernetes_service_deployment(
    name = "deploy",
    component = "//projects/apps/example-worker:image",
    **github_app_requirements("example-worker-staging")
)
```

For an intentionally shared platform app, pass a reviewed
`contract_prefix = "deployments/shared-github-apps/<name>"`. Repository
selection, installation IDs, refresh state, and imported snapshot state stay in
the application database rather than deployment metadata.

Use `--artifact-dir <dir>` only when you want to override that default and name a
specific build output folder as the client-side artifact source.

For protected/shared service-backed runs, a local folder is only an artifact
source. The CLI or reviewed profile workflow must upload, stage, or otherwise
admit the artifact through `mini` before provider mutation. The service request
computes the expected artifact identity, requests a short-lived one-time
challenge from `mini`, then submits a proof bound to the finalized staged
artifact reference. `mini` recomputes the admitted identity from the staged
bytes and rejects missing proofs, replayed challenges, or identity drift before
worker queueing. Protected/shared service-backed runs must not rely on a
laptop-local path as authority.

Use this when:

- you want to publish the latest version defined by the deployment target
- you are not trying to reuse an earlier run
- you want the standard repo-driven path

Preview from an earlier accepted run:

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --preview \
  --source-run-id <deploy-run-id>
```

Use this when:

- you want a temporary preview without replacing the normal live target
- you want to inspect an earlier accepted run in isolation
- you already know the `deploy-run-id` you want to preview

Preview cleanup:

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --preview-cleanup \
  --source-run-id <deploy-run-id>
```

Use this when:

- you are done with a preview deployment
- you want to remove preview resources created from an earlier run

Retry a previous run without rebuilding:

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --publish-only \
  --source-run-id <deploy-run-id>
```

Use this when:

- the earlier run already built the right artifact
- you want to try publishing that same artifact again
- you do not want a new build

Rollback one deployment to an earlier run:

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --publish-only \
  --source-run-id <deploy-run-id> \
  --rollback
```

Use this when:

- the current live version is bad
- you want to restore a known good earlier run for the same deployment

Promote an earlier run to a different deployment:

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --publish-only \
  --source-run-id <deploy-run-id>
```

Use this when:

- one environment already has the build you want
- you want to publish that earlier run to another deployment target
- the target deployment's policy allows that promotion path

Example:

- run the command on `//projects/deployments/example-app/prod:deploy`
  with a `--source-run-id` that came from an earlier successful
  `//projects/deployments/example-app/staging:deploy` run

Provision infrastructure only:

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --provision-only \
  --source-run-id <deploy-run-id>
```

Use this when:

- you need an infrastructure change without publishing a new app version
- you want the infrastructure step to stay tied to one earlier accepted run

Target-transition workflows:

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --retire-target \
  --target-exception-ref <label>
```

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --migrate-target \
  --target-exception-ref <label>
```

Use these when:

- ownership of a target is changing
- a target should stop being used
- a reviewed exception object already exists for that change

For promotion, run the command on the target deployment label and set
`--source-run-id` to the earlier run you want to promote.

Promotion is service-backed for protected/shared deployments. The control plane
checks the selected source run against current stage state for the source
deployment and checks the target deployment's current stage state before it
admits the target-environment payload. Moving an environment branch, editing a
release pointer, or selecting a retained but no-longer-current run is not a
promotion authority.

Common example values:

- deployment label:
  `//projects/deployments/example-app/prod:deploy`
- source run id:
  `deploy-run-2026-04-16-abc123`
- target exception ref:
  `//projects/deployments/<package>:<target-exception>`

No default ExampleApp target-transition exception is checked in today. Use a
reviewed `deployment_target_exception(...)` label that matches the ownership
change you are making.

If a run returns `pending_approval`, do not submit it again. Approve the
existing run using the same `deploy_run_id`.

For protected/shared service-backed Vercel, Kubernetes, and S3 static
submissions, retrying the same normalized provider payload reuses the existing
admitted submission with dedupe mode `duplicate` instead of queueing a second
one. The payload fingerprint binds the operation kind, provider target identity,
admitted artifact or component artifact references, source-run/replay selector,
expected source revision, preview-cleanup source inputs, and smoke overrides.
Changing any of those fields creates a distinct submission.

For service-backed workflows, the `deploy` CLI also covers the common operator
inspection commands so you do not need to hand-build HTTP requests:

Protected/shared deployment targets that select a `deployment_context` with a
`controlPlane` use that context-selected service URL and service-token ref by
default. `--control-plane-url` and `VBR_DEPLOY_CONTROL_PLANE_URL` are fallbacks
only for commands without a selected context; if they disagree with a selected
context, mutating commands fail unless `--allow-control-plane-override` is
passed with an explicit URL override. That override does not replace the
selected service-token ref: `--control-plane-token` and
`VBR_DEPLOY_CONTROL_PLANE_TOKEN` remain invalid token substitutes for
context-selected protected/shared deployments.

For commands without a selected deployment context, `--remote <name>` selects a
checked-in `projects/config/shared.json` `controlPlanes.<name>` profile. The
profile supplies both `serviceClient.controlPlaneUrl` and
`serviceClient.controlPlaneTokenRef`; the token ref must resolve through
`secret://...` or `runtime://...` before the provider front door contacts the
service. Protected/shared deployments that do have a `deployment_context` fail
closed when that context does not resolve a valid control plane, even if
`--control-plane-url`, `VBR_DEPLOY_CONTROL_PLANE_URL`, or ambient token
material is present.

If the selected service-token ref is `secret://...`, the CLI resolves it through
the selected deployment context's Vault or Infisical `DeploymentSecretContext`.
Missing backend runtime metadata, missing credential source, or an unresolved
service-token ref fails before provider mutation. Diagnostics may name the
deployment context, token ref, and backend kind, but they redact token values
and backend payloads. `runtime://...` token refs remain separate runtime-host
bindings and do not use SprinkleRef secret resolution.

Fixture secret files do not satisfy protected/shared context-selected
`secret://...` control-plane token refs when the selected real
`DeploymentSecretContext` is missing. A diagnostic that says
`rejected missing secretContext` or `rejected fixture fallback` means the
deployment context must select a valid secret backend and runtime credential
source before the provider front door will run. Project config validation also
checks unreferenced `controlPlanes` entries from shared and local config; fix
stale malformed refs or plaintext token-shaped fields even when no deployment
currently selects that profile.

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --status \
  --deploy-run-id <deploy-run-id>
```

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --print-run-lock-scope \
  --deploy-run-id <deploy-run-id>
```

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --approve \
  --deploy-run-id <deploy-run-id> \
  --approval-id <ticket-or-review-ref>
```

Use `--status` when you want the full run status JSON, `--print-run-lock-scope`
when you only need the exact admitted target scope string, and `--approve`
when the run is waiting for human approval.

To inspect the indexed deployment-intent resource graph from the same service
client path, use:

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --resource-graph
```

This calls `GET /api/v1/resource-graph` and returns the non-authoritative read
model. Deployment-specific submission, queue, lock, idempotency, artifact,
stage-state, session, and audit tables remain the mutation authority. Runtime
graph status is derived from those admitted records and can show run actions,
artifact challenges, upload sessions, retained evidence, current state, and
stage history without exposing a generic mutation path. Provider observed-state
evidence appears as `ProviderEvidence` resources with explicit supported,
unsupported, or deferred semantics for provider release ids, drift, preview,
partial publish, smoke/readiness, and rollback/recovery fields.

To answer what is currently deployed in a protected/shared stage, use the
control-plane current-stage helpers rather than Git release-pointer files:

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --current-stage-state \
  --text
```

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --stage-history
```

The helpers derive deployment id and environment stage from reviewed deployment
metadata and call `GET /api/v1/current-stage-state` or
`GET /api/v1/stage-history`. The current state includes the latest deployed
source revision, artifact identity, parent/source run, lineage, outcome, and
approval context.
Add `--by-deployment` to list every current lane/stage state for the deployment
or `--by-stage` to list every deployment currently recorded in the reviewed
stage; those modes call the same API with only `deploymentId` or only
`environmentStage`.

If you are using the reviewed `nixos-shared-host` client profile workflow, use
`--profile mini` instead of `--control-plane-url`.
For auth-required protected/shared runs, the deployment service opens or prints
the login URL and records the approver from the authenticated service session.
`--admit-and-deploy` remains an authorized shortcut for constructing
`admissionEvidence.checks`, but it is not a local bypass: the same principal
still needs `submitter` to request the deploy and `admission_reporter` to
report submit-time checks for that scope.
Use `--admit-only` when you want to emit the admission evidence JSON without
deploying, and `--admit-and-deploy` when you want to submit that evidence and
deploy in one command.
To discover the reviewed check names before you use either admission shortcut, run
`deploy --deployment <label> --validate-only` and inspect
`admissionRequirements.admission_policy`, `source_ref_policy`, `allowed_refs`,
`required_checks`, `required_approvals`, and `trusted_admission_reporters` in
the JSON response. That read-only output tells you which reviewed source policy
and check names the deployment expects; it does not grant `admission_reporter`.
For reviewed identity diagnostics, keep group shape and membership separate:
`deploy auth print-groups --deployment <label>` prints the deployment-derived
group shape, and `deploy auth explain-groups --deployment <label> --action
submit|approve|report_checks` explains which reviewed group is required for one
action. Those commands describe the expected identity group shape; they do not
add user or automation membership.

For Jenkins-backed dev deploys, have Jenkins build the artifact, retain it under
a CI artifact reference, then submit the request with explicit CI evidence and a
stable idempotency key:

```bash
build-tools/tools/bin/nixos-shared-host-jenkins-deploy \
  --deployment //projects/deployments/example-app/dev:deploy \
  --profile mini \
  --artifact-dir "$WORKSPACE/dist" \
  --admission-evidence-json "$WORKSPACE/deploy-admission.json" \
  --idempotency-key "jenkins:${JOB_NAME}:${BUILD_TAG}:example-dev" \
  --ssh-identity-file "$JENKINS_SSH_KEY" \
  --ssh-known-hosts "$JENKINS_KNOWN_HOSTS"
```

The evidence JSON must identify the reviewed source revision, Jenkins builder
identity, CI check results, artifact digest or retained artifact reference, and
any SBOM, signature, or provenance references. The Jenkins principal needs both
`submitter` for the deploy request and `admission_reporter` for the reported CI
evidence; the control plane rejects CI evidence reported by submitter-only
sessions.

For staging or production promotion requests from Jenkins, submit the promotion
to the protected service control plane and keep the idempotency key stable for
the Jenkins build or promotion attempt:

```bash
deploy --deployment //projects/deployments/example-app/staging:deploy \
  --publish-only \
  --source-run-id "$DEV_DEPLOY_RUN_ID" \
  --idempotency-key "jenkins:${JOB_NAME}:${BUILD_TAG}:promote-staging"
```

```bash
deploy --deployment //projects/deployments/example-app/prod:deploy \
  --publish-only \
  --source-run-id "$STAGING_DEPLOY_RUN_ID" \
  --idempotency-key "jenkins:${JOB_NAME}:${BUILD_TAG}:promote-prod"
```

Promotion requests reuse the admitted upstream run identity. If a stage is
configured for rebuild-per-stage, Jenkins must submit a stage-specific artifact
with fresh CI evidence instead of promoting the prior stage's artifact. In both
cases, the control plane accepts the request only when the selected source run
and the target deployment remain promotable in current stage state; Jenkins does
not promote by moving `env/<family>/<stage>` branches or hand-maintained pointer
files.
Keep the split explicit: read-only `deploy auth ...` explains the expected
shape, while privileged `deploy admin ...` applies reviewed identity changes.
Start with:

```bash
deploy admin identity plan --deployment <label>
deploy admin identity sync \
  --deployment <label> \
  --realm-file ./deployment-host/identity-provider/deployment-auth-realm.json \
  --acting-principal <principal> \
  --admin-group deploy-admin-identity-shape-admin-project-<project>
deploy admin identity grant-user \
  --deployment <label> \
  --action submit \
  --user-email <user@example.com> \
  --membership-file ./deployment-host/identity-provider/deployment-auth-memberships.json \
  --acting-principal <principal> \
  --admin-group deploy-admin-identity-membership-admin-project-<project>
```

`deploy admin identity sync` stages reviewed group shape and mapper updates in
the realm file. `deploy admin identity grant-user` stages human membership in a
separate reviewed input. Both fail closed unless the acting principal presents
the separate deploy-admin identity grant; ordinary `submitter`, `approver`, and
`admission_reporter` groups do not authorize identity-admin mutation. On shared
hosts, the reviewed identity-provider module reconciles those bootstrap
artifacts into the live persisted realm during host reconciliation for both
fresh installs and upgrades of an existing realm, while `deploy admin identity
...` remains the steady-state human operator path after login is aligned.
When you are operating `mini` from a client machine, use the reviewed remote
profile flow instead of SSHing in to edit those files by hand:

```bash
deploy admin identity sync \
  --deployment <label> \
  --profile mini \
  --apply-host-dry-run
deploy admin identity grant-user \
  --deployment <label> \
  --profile mini \
  --action submit \
  --apply-host
deploy admin identity grant-user \
  --deployment <label> \
  --profile mini \
  --action submit \
  --user-email alice@example.com \
  --apply-host
```

That reviewed remote path writes the authoritative identity JSON inputs under
the host config root as mutable generated files, and the reviewed
identity-provider module bootstraps and runtime-links them for Keycloak during
activation. No commit or staging step is required before the optional reviewed
host-apply dry-run or switch contract runs. The reviewed login session derives
the acting principal and deploy-admin identity scope automatically, so the
normal `--profile mini` path does not require `--acting-principal`,
`--admin-group`, `--realm-file`, or `--membership-file`. Omit `--user-email`
for self-service grants to the logged-in human, and add it only when granting a
reviewed capability to another user. That happy path also requires the reviewed
interactive login session to include an authoritative email for the current
human, usually via the IdP's standard `email` claim; if the session omits it,
fix the reviewed identity mapper before retrying. Keep the explicit file and
principal/group flags for intentionally local or non-remote workflows only.
For protected/shared service-backed runs, `--admit-and-deploy` and
`--admit-for-commit` only describe the commit the client believes it is
submitting. Final admission still binds to the service-owned reviewed source
snapshot selected by the deployment's source-ref policy. If the service returns a
reviewed source mismatch, compare `clientExpectedSourceRevision` with
`serviceReviewedSourceRevision`: either sync the service-side reviewed source or
rerun with `--admit-for-commit <serviceReviewedSourceRevision>` only when
that fetched service revision is intentionally the reviewed commit to deploy.
For supported SCM backends, protected/shared service-backed runs also use
service-owned lane governance verification. The normal reviewed flow does not
need client-supplied `laneGovernance` JSON; the service verifies reviewed
source-ref policy, required checks, trusted reporter identities, and approval
boundaries before it admits the run, then stores the resulting fact with
`verificationSource = "service_verified"`. If the hosted service is verifying a
GitHub-backed lane, configure `VBR_DEPLOY_GITHUB_TOKEN` on the service host so
it can read the live governance state. Unsupported SCM backends still fail
closed unless you intentionally provide reviewed compatibility evidence through
`--admission-evidence-json`.
Do not pass laptop Vault tokens, Vault JWT files, secret fixture paths, or
client-supplied principals to protected/shared service deployments. `mini`
derives identity through its service session and the worker uses server-owned
secret context for provider mutation. Use HTTPS service URLs and reviewed SSH
known-host or pinning configuration for protected/shared remote profiles; local
HTTP is only for explicit local test fixtures marked with
`VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1`. Remote-profile uploads finalize under the
configured staging root before proof submission, and the service admits only the
canonical finalized tree into the content-addressed store.
When a service-backed request returns `unauthorized`, read the rejection text:
submit failures now distinguish missing `submitter`, missing
`admission_reporter`, and missing `approver` access. Follow the suggested
`deploy auth explain-groups --deployment <label> --action ...` command first.
If membership or group shape is genuinely missing, switch to the privileged
reviewed `deploy admin identity plan --deployment <label>` flow and then apply
the matching `deploy admin identity sync` or `deploy admin identity grant-user`
step instead of editing Keycloak by hand.

## Which Backend Am I Using

`nixos-shared-host`

- good fit for static sites and the currently supported single-service SSR app
  path
- includes host setup, client setup, remote plan, remote deploy, Jenkins deploy,
  and approval on a waiting run
- start with [NixOS Shared Host Usage](nixos-shared-host-usage.md)

`cloudflare-pages`

- good fit for static sites
- start new packages with
  `scaf new deployment cloudflare-pages <deployment-id> --component=<static-webapp-target> --account=<cloudflare-account> --project=<pages-project>`
  so `TARGETS` and `wrangler.jsonc` are created together
- supports preview, preview cleanup, retry, rollback, and promotion from the
  main `deploy` command
- keep account, project, domains, lane policy, admission policy, preview, smoke,
  and secret requirements in `TARGETS`; keep `wrangler.jsonc` limited to
  provider-native Wrangler settings such as `$schema` and `compatibility_date`
- use this guide plus [Deployment Provider Capabilities](deployment-provider-capabilities.md)
  for the exact supported behavior

`cloudflare-containers`

- good fit for SSR apps, APIs, private services, and no-ingress Worker-fronted
  container workloads that need Cloudflare Containers instead of static Pages
- start new packages with
  `scaf new deployment cloudflare-containers <deployment-id> --component=<service-or-ssr-target> --cloudflare_account_id=<32-hex-account-id> --worker=<worker-name>`
- the scaffold defaults to `--ingress_mode=private`; use public custom-domain
  examples for web/SSR workloads, and `--ingress_mode=none` for worker-style
  services with no public route
- protected/shared public ingress must declare `domain` and
  `cloudflare_zone_id` unless a reviewed non-production `workers.dev`
  exception is set in metadata
- `deploy --deployment <label> --validate-only` accepts reviewed
  `cloudflare-containers` metadata through the shared front-door validation path
- the initial publisher is a local/fake `cloudflare-containers-local` adapter
  that records admitted image identity and Worker config fingerprint; protected
  shared live mutation fails closed until a reviewed live publisher lands
- keep account id, Worker name, ingress mode, domain, lane policy, admission
  policy, and secret requirements in `TARGETS`; keep `wrangler.jsonc` and the
  Worker entrypoint limited to provider-native Cloudflare config

`s3-static`

- good fit for static sites
- supports infrastructure-aware static publishing, including provision-only flows
- protected/shared worker execution uses a frozen admitted snapshot with the
  shared admission-engine result and admitted static artifact reference; queued
  snapshots do not carry laptop-local artifact directories
- use this guide plus [Deployment Provider Capabilities](deployment-provider-capabilities.md)
  for the exact supported behavior

`kubernetes`

- good fit for services and third-party services
- uses the same `deploy` command, with Kubernetes-specific rollout rules
- declare single-service apps with `kubernetes_service_deployment(...)`; web services require public
  ingress plus a health path, while worker services must not declare public ingress
- checked-in `helm/values.yaml` can carry chart, smoke URL, service kind, ingress mode, and health
  path; deploy injects admitted service artifacts into the rendered provider config
- `helm/values.yaml` must not set cluster, namespace, release, provider target
  identity, service kind, ingress mode, or health path differently from Buck
  deployment metadata. Protected/shared workers freeze the rendered values in
  the execution snapshot before any Helm mutation.
- service artifacts must be admitted immutable references, `sha256:<digest>`
  files, or image references pinned with `@sha256`. Mutable tag identities such
  as `latest`, `dev`, `staging`, and `prod` are rejected; do not promote by
  editing YAML image tags.
- live Kubernetes release identity drift fails closed before publish. The
  reviewed reconciliation path is the Helm publish step using the admitted
  artifact identities from the execution snapshot.
- app deployments can attach an `opentofu-stack` provisioner when stack files
  live under the deployment package `opentofu/` directory, with `plan_json`
  pointing at reviewed JSON evidence and `apply_plan` pointing at the saved plan
  from `tofu plan -out=...`; the reviewed JSON plan must be non-destructive
- the OpenTofu reviewed apply path consumes the recorded provisioner plan
  artifact, reviewed JSON fingerprint, saved apply-plan path, stack config
  fingerprint, stack identity, and state backend identity; mismatches against
  admission evidence fail closed and never invoke `tofu apply`
- Kubernetes control-plane workers construct the production OpenTofu adapter
  when no test hook adapter is injected. The adapter runs the pinned `tofu`
  from the Nix dev shell by default, or `VBR_OPENTOFU_BIN` /
  `VBR_DEPLOY_OPENTOFU_BIN` when a reviewed worker profile pins an explicit
  binary path.
- OpenTofu provider and backend credentials are resolved exclusively through
  deployment `secret_requirements` at the `provision` step, never from ambient
  process environment, and credential values are never written to deployment
  records (only credential names plus the redacted apply diagnostics surface)
- routine protected/shared flows reject `delete`, `replace`, or unknown plan
  actions; reviewed destructive workflows must attach a
  `destructiveExceptionRef` evidence entry before any destructive plan can apply
- Kubernetes service publish credentials (kubeconfig, service-account token, or
  control-plane-issued short-lived credential reference) are resolved through
  deployment `secret_requirements` at the `publish` step, both for the normal
  deploy path and for retry, rollback, and promotion replays. Protected/shared
  Kubernetes service deployments without a reviewed publish-step contract fail
  closed before Helm runs, ambient cluster credentials are scrubbed from the
  publisher process, and only the resolved credential env names plus contract
  refs are written to deploy records (never the credential values)
- protected/shared worker execution starts from a frozen admitted snapshot that
  carries component artifact identities, secret-contract references, and the
  shared admission evaluation result instead of raw client artifact paths
- choose Vault or Infisical per deployment with `secret_backend` and the matching
  runtime metadata. Keep provider credential contracts in `secret_requirements`;
  the backend choice changes where admitted references resolve, not which
  credentials the provider declares.
- backend migration from Vault to Infisical affects only future admissions.
  Retry and rollback use the recorded admitted backend references from the
  source run, while promotion selects the reviewed source artifact and then
  admits fresh target-deployment secret references from the target's current
  metadata.
- ExampleApp staging and production now use the Infisical backend for the existing
  `secret://deployments/example-app/cloudflare_api_token` contract. The secret is a
  shared Infisical secret named `cloudflare_api_token` at `/` in the
  `example-deployments` project, with `staging` and `prod` environments.
- ExampleApp staging and production select `example-staging` and `example-prod`
  deployment contexts. The contexts in `projects/config/shared.json` own the
  shared Cloudflare Pages and Infisical topology; the deployment family keeps
  only logical refs and stage policy.
- ExampleApp dev stays on the Vault-backed shared-host path so old dev workflows
  and old Vault-admitted replay records remain interpretable.
- Before the first live ExampleApp Infisical rollout, run the reviewed one-command
  bootstrap flow instead of manually applying the OpenTofu module or hunting for
  organization ids:

```bash
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts \
  deployment \
  --target //projects/deployments/example-app/staging:deploy \
  --org-name viberoots \
  --yes \
  --tofu-plan-file .local/example-app-infisical.tfplan
```

The `--yes` flag is non-interactive pre-confirmation for mutation-capable bootstrap. Local
interactive operators may omit it and confirm the prompt before Infisical, OpenTofu, resolver config,
or credential-sink mutations begin. In CI or a non-interactive operator shell, also provide a
short-lived admin token and an explicit organization selector:

```bash
INFISICAL_ACCESS_TOKEN='<redacted>' \
  viberoots/build-tools/tools/deployments/infisical-bootstrap.ts \
  deployment \
  --target //projects/deployments/example-app/staging:deploy \
  --no-login \
  --org-name viberoots \
  --yes \
  --tofu-plan-file .local/example-app-infisical.tfplan
```

The bootstrap command creates or preserves the bootstrap IaC identity, runs
`tofu init`, saves a `tofu plan`, prints a non-secret summary, applies that saved plan, reconciles
non-secret OpenTofu outputs against reviewed metadata, and manages bootstrap and deployment
Universal Auth access credentials through the selected SprinkleRef `bootstrap` category or explicit
compatibility sink. OpenTofu `init`, `plan`, and `apply` failures print the working directory, saved
plan path when available, and exact retry command without printing credential values. Enter the real
`cloudflare_api_token` values in Infisical outside this command after the project exists, then run
read-only `deploy admin infisical plan` and `deploy admin infisical check` for staging before
repeating the same check for production.

- The reviewed ExampleApp Universal Auth runtime names are
  `EXAMPLE_APP_STAGING_INFISICAL_CLIENT_ID`,
  `EXAMPLE_APP_STAGING_INFISICAL_CLIENT_SECRET`,
  `EXAMPLE_APP_PROD_INFISICAL_CLIENT_ID`, and
  `EXAMPLE_APP_PROD_INFISICAL_CLIENT_SECRET`. They are runtime bindings derived
  from service credential files, not values to commit, paste into local shells,
  or install in CI.
- If Infisical access is unavailable during rollout, restore Vault for new
  admissions by changing only ExampleApp staging and production metadata to select
  the reviewed Vault runtime and backend; keep the `secret_requirements` contract ids unchanged.
  Do not edit recorded admitted
  contexts: old Vault-admitted runs continue replaying with Vault references,
  and any already-recorded Infisical runs continue replaying with their exact
  Infisical references.
- Use this guide plus
  [Deployment Provider Capabilities](deployment-provider-capabilities.md) for
  the exact supported behavior.

Scaffold-first examples:

```bash
scaf new deployment shared console --repository=example/platform --yes
scaf new deployment vercel-next console-dev --component=//projects/apps/console:vercel_artifact --team=acme --project=console --shared_package=console-shared --yes
scaf new deployment cloudflare-pages console-staging --component=//projects/apps/console:app --account=web-platform-staging --project=console-staging-pages --shared_package=console-shared --yes
scaf new deployment cloudflare-containers console-ssr-staging --component=//projects/apps/console:ssr_service_artifact --component_kind=ssr-webapp --cloudflare_account_id=0123456789abcdef0123456789abcdef --worker=console-ssr-staging --ingress_mode=public --domain=console.example.com --cloudflare_zone_id=0123456789abcdef0123456789abcdef --shared_package=console-shared --yes
scaf new deployment cloudflare-containers api-private --component=//projects/apps/api:service_artifact --cloudflare_account_id=0123456789abcdef0123456789abcdef --worker=api-private --ingress_mode=private --shared_package=console-shared --yes
scaf new deployment cloudflare-containers worker-none --component=//projects/apps/worker:service_artifact --component_kind=third-party-service --cloudflare_account_id=0123456789abcdef0123456789abcdef --worker=worker-none --ingress_mode=none --shared_package=console-shared --yes
scaf new deployment service api-dev --component=//projects/apps/api:service_artifact --cluster=dev-cluster --shared_package=console-shared --yes
scaf new deployment opentofu-foundation foundation-dev --component=//projects/deployments/example/shared:migration_bundle --shared_package=example-shared --yes
scaf new deployment opentofu-provisioner api-dev --path=projects/deployments/api-dev --yes
```

The generated packages include placeholder secret/runtime config contract IDs and provider config
files. Replace those placeholders with reviewed provider/account/domain values before admission.

The reusable examples below use an illustrative ExampleApp family:

- `//projects/deployments/example-app/dev:deploy`
- `//projects/deployments/example-app/staging:deploy`
- `//projects/deployments/example-app/prod:deploy`

Speculative deployment families should not be committed under
`projects/deployments` in a consuming workspace. Keep capability coverage for new providers,
foundation-migration behavior, prerequisite admission, and smoke metadata in
temp-repo fixtures or purpose-built hermetic test workspaces until the product
deployment family is approved. When a future family is approved, add its shared
lane/admission package and concrete stage packages in the same plan PR that
updates the live-family guard.

Web service example:

```starlark
kubernetes_service_deployment(
    name = "web",
    component = "//projects/apps/api:image",
    cluster = "prod-us-west",
    namespace = "web",
    release = "api",
    service_kind = "web",
    ingress_mode = "public",
    health_path = "/healthz",
    lane_policy = "//projects/deployments/shared:lane",
    environment_stage = "prod",
    admission_policy = "//projects/deployments/shared:prod_release",
)
```

Worker service example:

```starlark
kubernetes_service_deployment(
    name = "worker",
    component = "//projects/apps/jobs:image",
    cluster = "prod-us-west",
    namespace = "workers",
    release = "jobs",
    service_kind = "worker",
    lane_policy = "//projects/deployments/shared:lane",
    environment_stage = "prod",
    admission_policy = "//projects/deployments/shared:prod_release",
)
```

`vercel`

- good fit for repo-built Next.js SSR apps that produce a Vercel Build Output
  API artifact
- publishes admitted `.vercel/output` artifacts with `vercel-prebuilt`
- resolves the Vercel API token through `secret_requirements`; do not pass
  provider tokens through ambient environment variables
- protected/shared profiles use the live Vercel REST API publisher by default;
  `local_only` fixtures keep using the deterministic fake publisher
- app-attached `opentofu-stack` provisioners are allowed when stack files remain
  under the owning deployment package's `opentofu/` directory
- preview, preview cleanup, retry, and rollback are source-run scoped audited
  operations; protected/shared mutations must route through the reviewed
  control-plane service path

Minimum live Vercel setup:

- declare a publish-step secret requirement named `vercel_api_token`, with a
  contract such as `secret://deployments/<deployment-id>/vercel_api_token`
- bind the secret contract to the deployment target lock scope
  `vercel:<team>/<project>#<environment>`
- keep `vercel-prebuilt.jsonc` checked into the deployment package with
  `mode = "prebuilt"`; `mode = "git-autobuild"` and ambient `.vercel` state are
  rejected
- configure any production or staging alias/domain as the deployment
  `canonical_url`, and verify DNS/domain ownership in Vercel before the run

Protected/shared Vercel control-plane examples:

```bash
# Deploy an already admitted prebuilt artifact through the control-plane service
deploy --deployment //projects/deployments/console-staging:deploy \
  --source-run-id <deploy-run-id>
```

```bash
# Preview from an earlier accepted run through the control-plane service
deploy --deployment //projects/deployments/console-staging:deploy \
  --preview \
  --source-run-id <deploy-run-id>
```

```bash
# Preview cleanup through the control-plane service
deploy --deployment //projects/deployments/console-staging:deploy \
  --preview-cleanup \
  --source-run-id <deploy-run-id>
```

```bash
# Retry an earlier accepted run by replaying the recorded exact artifact
deploy --deployment //projects/deployments/console-staging:deploy \
  --publish-only \
  --source-run-id <deploy-run-id>
```

```bash
# Rollback to an earlier accepted run on the same canonical live target
deploy --deployment //projects/deployments/console-staging:deploy \
  --publish-only \
  --rollback \
  --source-run-id <deploy-run-id>
```

Protected/shared Vercel mutations reject laptop-local artifact paths,
laptop-local records roots, and direct local-publish flags. Deploy, preview,
retry, rollback, and preview cleanup use source-run selectors for admitted
prebuilt artifacts and never rebuild from current branch state. The
control-plane service persists the admitted prebuilt artifact reference,
source-run selector, secret-contract references, and shared admission
evaluation in one frozen execution snapshot before worker mutation.
See [Vercel Troubleshooting](handbook/troubleshooting.md#vercel-control-plane-deployments)
for service submission, admission, replay, and provider API failure modes.

`app-store-connect`

- good fit for iOS apps
- use this guide plus [Deployment Provider Capabilities](deployment-provider-capabilities.md)
  for staged rollout and promotion rules

`google-play`

- good fit for Android apps
- use this guide plus [Deployment Provider Capabilities](deployment-provider-capabilities.md)
  for staged rollout, promotion, and replay rules

## When To Open Which Doc

Open this guide first when you want the right command quickly.

Open [Deployment Provider Capabilities](deployment-provider-capabilities.md)
when you need the exact support or restriction for one backend.

Open [Deployment And Secrets API](deployment-secrets-api.md)
when you need the exact `deploy` flags, HTTP API shapes, or secrets examples.

Open [Deployment Scenarios](deployment-scenarios.md)
when you need canonical expected behavior for a concrete operation such as
preview, retry, rollback, promotion, or provision-only.

Open [Deployments Design](history/designs/deployments-design.md)
when you are creating a new deployment definition or need architecture
background.
