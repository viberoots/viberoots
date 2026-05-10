# NixOS Shared Host Usage

This is the main day-to-day guide for deployments that go to `mini`.
It is also the start-here entrypoint for first-time `mini` setup.

If you are new here: `mini` is the shared NixOS machine that receives these
deployments.

Use this guide when you want the shortest path to the current day-to-day
workflow:

- first-time bring-up on `mini`
- reviewed remote plan and deploy commands
- Jenkins usage
- what to do when a run is waiting for approval
- how to check status using the IDs returned by the deployment service

Use the deeper references when needed:

- [Deployments Usage](deployments-usage.md)
  for the repo-wide reviewed deployment workflows across all provider families
- [NixOS Shared Host Setup](nixos-shared-host-setup.md)
  for install details, alternate install modes, status, and uninstall
- [NixOS Shared Host Technician Checklist](nixos-shared-host-technician-checklist.md)
  for the short SOP handoff path
- [Mini Shared-Dev Deployment Design](mini-deployment.md)
  for background on why `mini` is set up this way
- [Deployment Contract](deployments-contract.md)
  for the strict system rules behind these workflows
- [Vault Production Bootstrap Runbook](vault-production-bootstrap.md)
  for the canonical Vault bring-up path when `mini` deploys need Vault-backed
  secrets

## Start Here For `mini` Setup

If you are setting up `mini` for the first time, start with this page.

Use this entry sequence:

1. stay on this page for the reviewed bring-up order and the first commands to
   care about
2. open [NixOS Shared Host Setup](nixos-shared-host-setup.md)
   when you need the full install, status, uninstall, or alternate-install-mode
   reference
3. open [NixOS Shared Host Technician Checklist](nixos-shared-host-technician-checklist.md)
   when you need the short SOP handoff
4. open [Mini Shared-Dev Deployment Design](mini-deployment.md)
   only when you need the design rationale behind the `mini` workflow

Current supported scope:

- provider family: `nixos-shared-host`
- component kinds:
  - `static-webapp`
  - `ssr-webapp` for the reviewed single-component host slice
- protection class: `shared_nonprod`
- example deployment: `//projects/deployments/pleomino-dev:deploy`

## Before You Start

You only need this guide if:

- your deployment target uses the `nixos-shared-host` backend
- you are deploying to `mini`
- you want the supported path for shared dev deployments

## First-Time Bring-Up

For a fresh `mini` install, follow this exact order:

1. run the server install on `mini`
2. optionally import the reviewed service modules from
   `/srv/common/build-tools/tools/nix/shared-host-identity-provider-module.nix`,
   `/srv/common/build-tools/tools/nix/shared-host-postgres-module.nix` and
   `/srv/common/build-tools/tools/nix/shared-host-vault-module.nix` when you want
   repo-managed local identity-provider, Postgres, and Vault services on `mini`.
   Also import
   `/srv/common/build-tools/tools/nix/shared-host-deployment-service-module.nix`
   when `mini` should serve the reviewed hosted deployment API route and
   `/srv/common/build-tools/tools/nix/shared-host-deploy-auth-callback-module.nix`
   when `mini` should serve the reviewed public PKCE callback route.
3. wire `/etc/nixos/deployment-host/default.nix` into the
   authoritative NixOS config and apply it with `sudo nixos-rebuild switch`
4. start the deployment service and worker on `mini`
5. install the client profile on each dev machine or Jenkins worker
6. render a remote plan
7. run the remote deploy flow

Use the checklist for the short step-by-step path and the setup guide for the
full command reference.

## Reviewed Capabilities

The current supported path includes:

- server install on `mini`
- starting the deployment service and worker on `mini`
- installing a client profile on dev machines and Jenkins workers
- remote plan and remote deploy through that client profile
- Jenkins deploy through SSH plus a deployment-service submission
- approval grant on an existing `pending_approval` run
- normal status and record inspection through the deployment service, using
  `submissionId` or `deployRunId`

You do not need to read design docs, inspect internal JSON files, or pass
deployment-service flags directly to the remote wrapper commands.

## Vault For `mini`

If your `mini` deployments use deployment secrets, the canonical Vault setup
instructions live in
[Vault Production Bootstrap Runbook](vault-production-bootstrap.md).

If you want `mini` itself to run the local services, the reviewed importable
starting modules live here:

- `/srv/common/build-tools/tools/nix/shared-host-postgres-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-vault-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-identity-provider-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-deployment-service-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-deploy-auth-callback-module.nix`

For a flake-based `/etc/nixos` host, expose only the module directory as a
non-flake input:

```nix
inputs.deploymentModules = {
  url = "path:/srv/common/build-tools/tools/nix";
  flake = false;
};
```

Then import the modules through `deploymentModules` or a `specialArgs` value
derived from it. Do not import `/srv/common/...` directly from
`configuration.nix` during `nixos-rebuild switch --flake`; pure flake evaluation
rejects absolute paths outside the flake input graph. Avoid pointing the input at
all of `/srv/common`, since that copies the full repo into the store.

On the current `mini` host shape, those modules augment an existing
configuration that already owns nginx, wildcard ACME, firewall lists, and DNS
rewrites. Use `deploymentHost.vault.useAcmeCertificate = true` for direct
Vault TLS on the existing `*.apps.kilty.io` certificate, and set the
identity-provider `manageNginx`, `manageAcme`, and `openFirewall` flags to
`false` when adding a host-owned `identity.apps.kilty.io` nginx vhost. Use the
deployment-service module the same way for `deploy.apps.kilty.io`, routing to
`127.0.0.1:7780` without opening that local service port publicly. The deploy
auth callback module handles `deploy-auth.apps.kilty.io/oidc/callback` on the
same private service listener. The modules do not choose public domains for you;
set `publicHostname`, `acmeCertName`, `identityProvider.hostname`,
`deploymentService.hostname`, and `deployAuthCallback.hostname` from the host
config.

Use that runbook when you need to:

- initialize and unseal Vault
- enable audit logging, KV v2, and JWT auth roles
- inspect credential-source selection with `deploy auth doctor` and Vault role
  expectations with `deploy auth explain-vault-role`
- optionally run the reviewed `deploy-vault-jwt` helper for low-level
  client-credentials token smoke/debug checks
- create the read policy used by deployment secret resolution
- write the deployment secrets themselves
- export a reviewed secret fixture for local/test/bootstrap workflows

This shared-host usage guide does not replace the Vault runbook. It tells you
how to bring up and use `mini`; the Vault runbook tells you how to bring up the
secret backend that `mini`-targeted deployments can consume.

## Install The Reviewed Client Profile

Run this on each dev machine or Jenkins worker:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  client install \
  --profile mini \
  --control-plane-url https://deploy.apps.kilty.io
```

A client profile is a local file that tells the deploy command how to reach
`mini`.

It stores:

- the SSH details for talking to `mini`
- the deployment service URL
- the environment variable name that holds the service token

What the install flags mean:

- `--profile mini`
  The local profile name. Use `mini` when this machine should talk to the
  shared host named `mini`.
- `--destination mini`
  The human-readable destination name stored in the profile. It defaults to the
  profile name, so the reviewed `mini` workflow does not need this flag.
- `--remote-repo-path /srv/common`
  The default repo checkout on `mini` that remote deploy commands should use.
  Override only if the checkout lives elsewhere.
- `--remote-state-path /etc/nixos/deployment-host/platform-state.json`
  The default host state file used by the shared-host deployment backend. It
  sits inside the NixOS flake tree because the generated host module reads it
  during pure evaluation; do not put secrets in it.
- `--remote-runtime-root /var/lib/deployment-host/runtime`
  The default root directory where runtime files are materialized on `mini`.
- `--remote-records-root /var/lib/deployment-host/records`
  The default root directory where deployment records are stored on `mini`.
- `--ssh-mode ssh`
  Default value. Selects the SSH transport for remote command execution. Use
  the default unless a future reviewed transport mode exists.
- `--control-plane-url https://deploy.apps.kilty.io`
  The hosted deployment service URL that laptop clients should call.
- `--control-plane-token-env VBR_DEPLOY_CONTROL_PLANE_TOKEN`
  Default value. This stores the environment variable name that holds the
  deployment service token on the client machine or Jenkins worker; it does not
  store the token value.

## Review The Remote Plan

From a dev machine:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --plan
```

The plan output should show:

- destination `mini`
- remote repo path `/srv/common`
- remote state path `/etc/nixos/deployment-host/platform-state.json`
- remote runtime root `/var/lib/deployment-host/runtime`
- remote records root `/var/lib/deployment-host/records`
- a `serviceClient` block with the deployment service URL and token env

Protected/shared `mini` deploys now use service-owned lane governance
verification for supported SCM backends. In the normal reviewed workflow you do
not hand-build `laneGovernance` JSON. The service verifies the live governance
state itself, stores the admitted fact with
`verificationSource = "service_verified"`, and fails closed on drift. For
GitHub-backed lanes, the hosted service needs `VBR_DEPLOY_GITHUB_TOKEN` so it
can read the live branch-protection state. If a deployment still uses an
unsupported SCM backend, keep explicit lane-governance evidence in
`--admission-evidence-json` only as a reviewed compatibility path.

## Run The Reviewed Remote Deploy

From a dev machine, if `./dist` is your built app output folder:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --artifact-dir ./dist
```

`--artifact-dir ./dist` is optional here. It is a client-side source override:
the reviewed profile workflow transports that folder to `mini` first, then the
hosted deployment service works from the `mini`-side staged or admitted artifact.
The service submission must not trust a laptop-local path as deployment
authority. The client computes the expected artifact identity before upload,
requests a one-time service challenge, stages the artifact with strict SSH
host-key verification, uploads into a temporary directory under the configured
staging root, and atomically finalizes that directory before proof submission.
The service consumes the challenge once, canonicalizes the finalized path under
the staging root, verifies the completion marker and immutable file modes,
recomputes the admitted artifact identity from the finalized tree, and rejects
proof, challenge, filesystem, or identity mismatches before worker queueing.
When a protected/shared staged upload is rejected during challenge issuance,
proof verification, identity admission, or queue preconditions, cleanup is a
service responsibility. The service removes the finalized staged tree when it
can; if cleanup fails, it records a bounded janitor item with only redacted
staged-reference metadata. `--retain-remote-artifact` is a debug convenience
for accepted remote-profile runs only and does not preserve rejected
protected/shared staged uploads.

If the client loses the submit response, it should retry the exact same
submission id or idempotency key with the same challenge, proof, and request
body. The service returns the existing accepted submission without trying to
consume the one-time challenge again. A retry that changes the proof, expected
identity, source, staged reference, or envelope is treated as an idempotency
conflict, and replaying a consumed challenge under a different accepted
fingerprint fails closed. Submit and status output include only the redacted
artifact-binding audit summary; proof MACs, nonces, bearer tokens, and full
staged paths are not operator-facing fields.

Protected/shared service clients use HTTPS. Loopback HTTP is reserved for
explicit local fixture flows marked with `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1`,
and clients fail closed when TLS certificate validation is disabled.

If you omit `--artifact-dir`, the deploy command uses the deployment target
metadata to figure out which app target to build and where its artifact lives.

Common example values:

- `--artifact-dir ./dist`
  Typical static-site build output on a dev machine.
- `--artifact-dir "$WORKSPACE/projects/apps/pleomino/dist"`
  Typical CI build output in Jenkins.

From Jenkins:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-jenkins-deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --artifact-dir "$WORKSPACE/projects/apps/pleomino/dist" \
  --ssh-identity-file "$JENKINS_SSH_IDENTITY" \
  --ssh-known-hosts "$JENKINS_KNOWN_HOSTS"
```

The remote-profile and Jenkins commands use SSH for staging files and basic
preflight work. The actual deployment request goes through the central
deployment service recorded in the client profile. Protected/shared profiles
must use HTTPS service URLs with certificate validation enabled, must provide
the reviewed `VBR_DEPLOY_CONTROL_PLANE_TOKEN` bearer token for the hosted
service, and must keep reviewed known-hosts or host-key pinning for SSH
staging. If the hosted token is missing or rejected, the service fails the
challenge or submit request closed and still cleans staged artifacts or records
bounded janitor metadata itself.

Do not pass `--control-plane-url`, `--apply-host`, or `--apply-host-dry-run`
to those wrappers. They read that information from the installed profile.

Do not pass Vault JWT files, Vault tokens, fixture paths, provider credentials,
or client-supplied principals through these client commands. For protected/shared
`mini` runs, the deployment service derives the authenticated principal and the
worker uses server-local Vault credential sources.
`--admit-and-deploy` is an authorized shortcut for constructing
`admissionEvidence.checks`; it does not bypass service-side authorization. The
same principal still needs `submitter` to request the deploy and
`admission_reporter` to report those checks. If a submit fails with
`unauthorized`, use the returned message to distinguish missing `submitter`
access from missing `admission_reporter` access.
Use `--admit-only` when you want to emit the admission evidence JSON without
deploying, and `--admit-and-deploy` when you want to submit that evidence and
deploy in one command.
Use `deploy auth print-groups --deployment <label>` to inspect the reviewed
Keycloak group shape for one deployment, and
`deploy auth explain-groups --deployment <label> --action submit|approve|report_checks`
to map one action to the reviewed group name. That helper surface explains
group shape only; user and automation membership remain a separate reviewed
identity-management step.
Keep the split clear: read-only `deploy auth ...` explains the expected shape,
while privileged `deploy admin ...` applies reviewed identity changes. The
reviewed admin flow is:

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

Those deploy-admin groups are intentionally separate from ordinary
`submitter`/`approver`/`admission_reporter` access. A missing ordinary deploy
grant and a missing deploy-admin grant are different failures on purpose.
For the normal client-driven `mini` workflow, skip manual SSH edits and run:

```bash
direnv exec . build-tools/tools/bin/deploy admin identity sync \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --apply-host-dry-run

direnv exec . build-tools/tools/bin/deploy admin identity grant-user \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --action submit \
  --apply-host

direnv exec . build-tools/tools/bin/deploy admin identity grant-user \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --action submit \
  --user-email alice@example.com \
  --apply-host
```

The reviewed remote-profile flow updates
`./deployment-host/identity-provider/deployment-auth-realm.json` and
`./deployment-host/identity-provider/deployment-auth-memberships.json` inside
the host config workspace as mutable generated files, then optionally runs the
same reviewed host-apply preflight and dry-run/switch helper the ordinary
remote deploy path uses. Keep those files gitignored; the identity-provider
module bootstraps missing files and reconciles the live persisted realm during
host reconciliation instead of expecting flake-visible tracked paths. That
reviewed migration path is the same for fresh installs and existing persisted
realms, so `deploy admin identity ...` remains the steady-state human operator
path after login is aligned. On this happy path, the reviewed login session
already supplies
the acting principal and the deploy-admin identity group scope, so `--profile
mini` no longer needs `--acting-principal`, `--admin-group`, `--realm-file`, or
`--membership-file`. Omit `--user-email` to grant yourself the reviewed
capability; add `--user-email alice@example.com` only for a cross-user grant.
The same reviewed login session must also carry an authoritative email for the
current human, typically through the IdP's standard `email` claim. If it does
not, update the reviewed identity mapper before retrying the self-service flow.
To discover the reviewed check names for a target before you submit, run
`direnv exec . build-tools/tools/bin/deploy --deployment <label> --validate-only`
and inspect `admissionRequirements.admission_policy`, `allowed_refs`,
`required_checks`, and `required_approvals`. That read-only output tells you
which names the deployment expects; it does not grant `admission_reporter`.
For protected/shared `mini` runs, submit-time evidence is finalized against the
service-owned reviewed snapshot of the deployment's authoritative stage ref, not
against your laptop checkout. If a submit returns a reviewed source mismatch,
compare `clientExpectedSourceRevision` with `serviceReviewedSourceRevision`.
Either sync the service-side reviewed ref or rerun with
`--admit-for-commit <serviceReviewedSourceRevision>` only when that
service-fetched commit is intentionally the reviewed one to deploy.

## Inspect Status And Results

Use the `deploy` helper to check status through the installed client profile:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --status \
  --text \
  --deploy-run-id "$DEPLOY_RUN_ID"
```

The text response gives you the current phase, approval guidance when the run is
waiting, and admitted artifact identity when the service has already admitted an
artifact. Challenge details are summarized only as redacted proof status; tokens,
nonces, and full staged paths are not operator-facing output. For automation,
omit `--text` to keep the machine-readable JSON response.

The response gives you two important IDs:

- `submissionId`: the request ID
- `deploy_run_id`: the run ID

Keep both. You will use them if you need to inspect the run again or approve
it later.

Example values:

- `submissionId = submission-2026-04-16T12:00:00Z`
- `deploy_run_id = deploy-run-2026-04-16-abc123`

## Approve A `pending_approval` Run

If the status output returns `lifecycleState = pending_approval`, the run is
waiting for human approval. Review that same run first:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --status \
  --text \
  --deploy-run-id "$DEPLOY_RUN_ID"
```

Before approving, check at least:

- `status.approval.state = pending`
- `status.approval.payloadFingerprint` matches the reviewed payload
- `status.approval.targetIdentity` matches the intended target
- `status.approval.provisionerPlanFingerprint` still matches when provisioning
  is in scope

Example values you might see:

- `status.approval.state = "pending"`
- `status.approval.payloadFingerprint = "sha256:payload-from-status"`
- `status.approval.targetIdentity = "nixos-shared-host:shared-nonprod:demoapp-dev"`
- `status.approval.provisionerPlanFingerprint = "sha256:plan-from-status"`

Then approve that same run:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --approve \
  --deploy-run-id "$DEPLOY_RUN_ID" \
  --approval-id ticket-123
```

What the approval flags mean:

- `--approval-id ticket-123`
  The human review reference, such as a ticket, change request, or approval
  record.

The helper reads the current status first and copies the expected payload
fingerprint, target identity, and provisioner-plan fingerprint automatically,
so you do not need to build the JSON request by hand.
For auth-required protected/shared runs, the service opens or prints the login
URL and records the approver from the authenticated service session.

Approval keeps the same `deploy_run_id` and continues the existing run. If you
get `approval_no_longer_valid` or `unauthorized`, re-run `--status` on that
same `deploy_run_id` and confirm the current approval fields before trying
again. For submit-time evidence failures, `unauthorized` now distinguishes
missing `submitter` access from missing `admission_reporter` access; approval
failures still point at missing `approver` access. Keep the follow-up flow
read-only first: use `deploy auth explain-groups` to confirm the expected group
shape. If the reviewed shape or membership is genuinely missing, switch to
`deploy admin identity plan --deployment <label>` and then apply the reviewed
`deploy admin identity sync` or `deploy admin identity grant-user` step instead
of dropping to raw IdP tooling.
