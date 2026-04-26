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
target automatically.

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
`--mark-check-passed` remains an authorized shortcut for constructing
`admissionEvidence.checks`, but it is not a local bypass: the same principal
still needs `submitter` to request the deploy and `admission_reporter` to
report submit-time checks for that scope.
To discover the reviewed check names before you use `--mark-check-passed`, run
`deploy --deployment <label> --validate-only` and inspect
`admissionRequirements.admission_policy`, `allowed_refs`, `required_checks`,
and `required_approvals` in the JSON response. That read-only output tells you
which names the deployment expects; it does not grant `admission_reporter`.
For reviewed Keycloak diagnostics, keep group shape and membership separate:
`deploy auth print-groups --deployment <label>` prints the deployment-derived
group shape, and `deploy auth explain-groups --deployment <label> --action
submit|approve|report_checks` explains which reviewed group is required for one
action. Those commands describe the expected Keycloak group shape; they do not
add user or automation membership.
Keep the split explicit: read-only `deploy auth ...` explains the expected
shape, while privileged `deploy admin ...` applies reviewed Keycloak changes.
Start with:

```bash
deploy admin keycloak plan --deployment <label>
deploy admin keycloak sync \
  --deployment <label> \
  --realm-file ./deployment-host/identity-provider/deployment-auth-realm.json \
  --acting-principal <principal> \
  --admin-group deploy-admin-keycloak-shape-admin-project-<project>
deploy admin keycloak grant-user \
  --deployment <label> \
  --action submit \
  --user-email <user@example.com> \
  --membership-file ./deployment-host/identity-provider/deployment-auth-memberships.json \
  --acting-principal <principal> \
  --admin-group deploy-admin-keycloak-membership-admin-project-<project>
```

`deploy admin keycloak sync` stages reviewed group shape and mapper updates in
the realm file. `deploy admin keycloak grant-user` stages human membership in a
separate reviewed input. Both fail closed unless the acting principal presents
the separate deploy-admin Keycloak grant; ordinary `submitter`, `approver`, and
`admission_reporter` groups do not authorize Keycloak mutation.
When you are operating `mini` from a client machine, use the reviewed remote
profile flow instead of SSHing in to edit those files by hand:

```bash
deploy admin keycloak sync \
  --deployment <label> \
  --profile mini \
  --acting-principal <principal> \
  --admin-group deploy-admin-keycloak-shape-admin-project-<project> \
  --apply-host-dry-run
deploy admin keycloak grant-user \
  --deployment <label> \
  --profile mini \
  --action submit \
  --user-email <user@example.com> \
  --acting-principal <principal> \
  --admin-group deploy-admin-keycloak-membership-admin-project-<project> \
  --apply-host
```

That reviewed remote path writes the authoritative Keycloak JSON inputs under
the host config root as mutable generated files, and the reviewed
identity-provider module bootstraps and runtime-links them for Keycloak during
activation. No commit or staging step is required before the optional reviewed
host-apply dry-run or switch contract runs.
For protected/shared service-backed runs, `--mark-check-passed` and
`--mark-check-for-commit` only describe the commit the client believes it is
submitting. Final admission still binds to the service-owned reviewed source
snapshot for the deployment's authoritative stage ref. If the service returns a
reviewed source mismatch, compare `clientExpectedSourceRevision` with
`serviceReviewedSourceRevision`: either sync the service-side reviewed ref or
rerun with `--mark-check-for-commit <serviceReviewedSourceRevision>` only when
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
reviewed `deploy admin keycloak plan --deployment <label>` flow and then apply
the matching `deploy admin keycloak sync` or `deploy admin keycloak grant-user`
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
- use this guide plus [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
  for the exact supported behavior

`kubernetes`

- good fit for services and third-party services
- uses the same `deploy` command, with Kubernetes-specific rollout rules
- use this guide plus [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)

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
