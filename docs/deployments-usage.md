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

- [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
  for model rationale, authoring structure, and policy intent
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
  for fail-closed shared operator and implementation guarantees
- [Deployment And Secrets API](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-secrets-api.md)
  for the public CLI, control-plane, and `secretspec` helper surface
- [Secrets Usage](/Users/kiltyj/Code/bucknix-fresh/docs/secrets-usage.md)
  for declaring deployment secret requirements and understanding the Vault
  workflow
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
  for reviewed provider-specific support and constraints
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
  for canonical scenario-by-scenario expectations
- [NixOS Shared Host Usage](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-usage.md)
  for the reviewed `mini` host workflow and the start-here path for first-time
  `mini` setup

## Main Command

The public repo-level entrypoint is:

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy
```

Use `--deployment <label>` to choose what you want to deploy.

If you are new to this repo, you can think of the label as the deployment's
unique name inside the repo. Example:

- `//projects/deployments/pleomino-prod:deploy`

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
deploy --deployment //projects/deployments/pleomino-prod:deploy
```

For a normal deploy, this is usually enough. The deployment definition tells
the CLI which app target to build, and the CLI resolves the artifact from that
target automatically. The same repo-level front door also enforces declared
readiness gates and rejects app targets that import other app targets before a
provider-specific mutation runs.

Use `--artifact-dir <dir>` only when you want to override that default and name a
specific build output folder as the client-side artifact source.

For protected/shared service-backed runs, a local folder is only an artifact
source. The CLI or reviewed profile workflow must upload, stage, or otherwise
admit the artifact through `mini` before provider mutation. The service request
computes the expected artifact identity, requests a short-lived one-time
challenge from `mini`, then submits a proof bound to the finalized staged
artifact reference. `mini` recomputes the admitted identity from the staged
bytes and rejects missing proofs, replayed challenges, or identity drift before
worker queueing.
must not rely on a laptop-local path as authority.

Use this when:

- you want to publish the latest version defined by the deployment target
- you are not trying to reuse an earlier run
- you want the standard repo-driven path

Preview from an earlier accepted run:

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy \
  --preview \
  --source-run-id <deploy-run-id>
```

Use this when:

- you want a temporary preview without replacing the normal live target
- you want to inspect an earlier accepted run in isolation
- you already know the `deploy-run-id` you want to preview

Preview cleanup:

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy \
  --preview-cleanup \
  --source-run-id <deploy-run-id>
```

Use this when:

- you are done with a preview deployment
- you want to remove preview resources created from an earlier run

Retry a previous run without rebuilding:

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy \
  --publish-only \
  --source-run-id <deploy-run-id>
```

Use this when:

- the earlier run already built the right artifact
- you want to try publishing that same artifact again
- you do not want a new build

Rollback one deployment to an earlier run:

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy \
  --publish-only \
  --source-run-id <deploy-run-id> \
  --rollback
```

Use this when:

- the current live version is bad
- you want to restore a known good earlier run for the same deployment

Promote an earlier run to a different deployment:

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy \
  --publish-only \
  --source-run-id <deploy-run-id>
```

Use this when:

- one environment already has the build you want
- you want to publish that earlier run to another deployment target
- the target deployment's policy allows that promotion path

Example:

- run the command on `//projects/deployments/pleomino-prod:deploy`
  with a `--source-run-id` that came from an earlier successful
  `//projects/deployments/pleomino-staging:deploy` run

Provision infrastructure only:

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy \
  --provision-only \
  --source-run-id <deploy-run-id>
```

Use this when:

- you need an infrastructure change without publishing a new app version
- you want the infrastructure step to stay tied to one earlier accepted run

Target-transition workflows:

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy \
  --retire-target \
  --target-exception-ref <label>
```

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy \
  --migrate-target \
  --target-exception-ref <label>
```

Use these when:

- ownership of a target is changing
- a target should stop being used
- a reviewed exception object already exists for that change

For promotion, run the command on the target deployment label and set
`--source-run-id` to the earlier run you want to promote.

Common example values:

- deployment label:
  `//projects/deployments/pleomino-prod:deploy`
- source run id:
  `deploy-run-2026-04-16-abc123`
- target exception ref:
  `//projects/deployments/<package>:<target-exception>`

No default Pleomino target-transition exception is checked in today. Use a
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

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy \
  --status \
  --deploy-run-id <deploy-run-id> \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy \
  --print-run-lock-scope \
  --deploy-run-id <deploy-run-id> \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

```bash
deploy --deployment //projects/deployments/pleomino-prod:deploy \
  --approve \
  --deploy-run-id <deploy-run-id> \
  --approval-id <ticket-or-review-ref> \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

Use `--status` when you want the full run status JSON, `--print-run-lock-scope`
when you only need the exact admitted target scope string, and `--approve`
when the run is waiting for human approval.

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
`admissionRequirements.admission_policy`, `allowed_refs`, `required_checks`,
and `required_approvals` in the JSON response. That read-only output tells you
which names the deployment expects; it does not grant `admission_reporter`.
For reviewed identity diagnostics, keep group shape and membership separate:
`deploy auth print-groups --deployment <label>` prints the deployment-derived
group shape, and `deploy auth explain-groups --deployment <label> --action
submit|approve|report_checks` explains which reviewed group is required for one
action. Those commands describe the expected identity group shape; they do not
add user or automation membership.
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
snapshot for the deployment's authoritative stage ref. If the service returns a
reviewed source mismatch, compare `clientExpectedSourceRevision` with
`serviceReviewedSourceRevision`: either sync the service-side reviewed ref or
rerun with `--admit-for-commit <serviceReviewedSourceRevision>` only when
that fetched service revision is intentionally the reviewed commit to deploy.
For supported SCM backends, protected/shared service-backed runs also use
service-owned lane governance verification. The normal reviewed flow does not
need client-supplied `laneGovernance` JSON; the service verifies live branch
protection, required checks, and reviewed branch-advance identities before it
admits the run, then stores the resulting fact with
`verificationSource = "service_verified"`. If the hosted service is verifying a
GitHub-backed lane, configure `BNX_DEPLOY_GITHUB_TOKEN` on the service host so
it can read the live governance state. Unsupported SCM backends still fail
closed unless you intentionally provide reviewed compatibility evidence through
`--admission-evidence-json`.
Do not pass laptop Vault tokens, Vault JWT files, secret fixture paths, or
client-supplied principals to protected/shared service deployments. `mini`
derives identity through its service session and the worker uses server-owned
secret context for provider mutation. Use HTTPS service URLs and reviewed SSH
known-host or pinning configuration for protected/shared remote profiles; local
HTTP is only for explicit local test fixtures marked with
`BNX_DEPLOY_LOCAL_FIXTURE_SERVICE=1`. Remote-profile uploads finalize under the
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
- start with [NixOS Shared Host Usage](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-usage.md)

`cloudflare-pages`

- good fit for static sites
- supports preview, preview cleanup, retry, rollback, and promotion from the
  main `deploy` command
- use this guide plus [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
  for the exact supported behavior

`s3-static`

- good fit for static sites
- supports infrastructure-aware static publishing, including provision-only flows
- protected/shared worker execution uses a frozen admitted snapshot with the
  shared admission-engine result and admitted static artifact reference; queued
  snapshots do not carry laptop-local artifact directories
- use this guide plus [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
  for the exact supported behavior

`kubernetes`

- good fit for services and third-party services
- uses the same `deploy` command, with Kubernetes-specific rollout rules
- declare single-service apps with `kubernetes_service_deployment(...)`; web services require public
  ingress plus a health path, while worker services must not declare public ingress
- checked-in `helm/values.yaml` can carry chart, smoke URL, service kind, ingress mode, and health
  path; deploy injects admitted service artifacts into the rendered provider config
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
  from the Nix dev shell by default, or `BNX_OPENTOFU_BIN` /
  `BNX_DEPLOY_OPENTOFU_BIN` when a reviewed worker profile pins an explicit
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
- use this guide plus [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)

Scaffold-first examples:

```bash
scaf new deployment shared console --repository=example/platform --yes
scaf new deployment vercel-next console-dev --component=//projects/apps/console:vercel_artifact --team=acme --project=console --shared_package=console-shared --yes
scaf new deployment service api-dev --component=//projects/apps/api:service_artifact --cluster=dev-cluster --shared_package=console-shared --yes
scaf new deployment opentofu-foundation platform-dev --component=//projects/deployments/platform-shared:migration_bundle --shared_package=platform-shared --yes
scaf new deployment opentofu-provisioner api-dev --path=projects/deployments/api-dev --yes
```

The generated packages include placeholder secret/runtime config contract IDs and provider config
files. Replace those placeholders with reviewed provider/account/domain values before admission.

Concrete Phase 0 packages:

- `//projects/deployments/platform-shared:lane` owns the dev/staging/prod lane,
  governance policy, admission policies, and `:migration_bundle`
- `//projects/deployments/platform-foundation-{dev,staging,prod}:deploy` owns
  provision-only OpenTofu foundation work through provider `opentofu`, publisher
  `provision-only`, and component `//projects/deployments/platform-shared:migration_bundle`
- `//projects/deployments/data-room-console-{dev,staging,prod}:deploy` publishes
  `//projects/apps/data-room-console:vercel_artifact` through Vercel and carries
  an app-attached `opentofu-stack` provisioner for project, domain, and env setup
- `//projects/deployments/data-room-web-{dev,staging,prod}:deploy` publishes
  `//projects/apps/data-room-web:service_artifact` through the container runtime
- `//projects/deployments/data-room-worker-{dev,staging,prod}:deploy` publishes
  `//projects/apps/data-room-worker:service_artifact` through the container runtime

The Phase 0 OpenTofu stack layout is package-local:
`projects/deployments/<deployment-id>/opentofu/{main.tf,plan.json,plan.tfplan,stack.json}`.
The reviewed migration bundle target combines
`//projects/libs/platform-db:migrations` before
`//projects/libs/data-room-db:migrations` and is attached to every
`platform-foundation-*` deployment as `migration_bundle`.

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
  --source-run-id <deploy-run-id> \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

```bash
# Preview from an earlier accepted run through the control-plane service
deploy --deployment //projects/deployments/console-staging:deploy \
  --preview \
  --source-run-id <deploy-run-id> \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

```bash
# Preview cleanup through the control-plane service
deploy --deployment //projects/deployments/console-staging:deploy \
  --preview-cleanup \
  --source-run-id <deploy-run-id> \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

```bash
# Retry an earlier accepted run by replaying the recorded exact artifact
deploy --deployment //projects/deployments/console-staging:deploy \
  --publish-only \
  --source-run-id <deploy-run-id> \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

```bash
# Rollback to an earlier accepted run on the same canonical live target
deploy --deployment //projects/deployments/console-staging:deploy \
  --publish-only \
  --rollback \
  --source-run-id <deploy-run-id> \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

Protected/shared Vercel mutations reject laptop-local artifact paths,
laptop-local records roots, and direct local-publish flags. Deploy, preview,
retry, rollback, and preview cleanup use source-run selectors for admitted
prebuilt artifacts and never rebuild from current branch state. The
control-plane service persists the admitted prebuilt artifact reference,
source-run selector, secret-contract references, and shared admission
evaluation in one frozen execution snapshot before worker mutation.
See [Vercel Troubleshooting](/Users/kiltyj/Code/bucknix-fresh/docs/handbook/troubleshooting.md#vercel-control-plane-deployments)
for service submission, admission, replay, and provider API failure modes.

`app-store-connect`

- good fit for iOS apps
- use this guide plus [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
  for staged rollout and promotion rules

`google-play`

- good fit for Android apps
- use this guide plus [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
  for staged rollout, promotion, and replay rules

## When To Open Which Doc

Open this guide first when you want the right command quickly.

Open [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
when you need the exact support or restriction for one backend.

Open [Deployment And Secrets API](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-secrets-api.md)
when you need the exact `deploy` flags, HTTP API shapes, or secrets examples.

Open [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
when you need canonical expected behavior for a concrete operation such as
preview, retry, rollback, promotion, or provision-only.

Open [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
when you are creating a new deployment definition or need architecture
background.
