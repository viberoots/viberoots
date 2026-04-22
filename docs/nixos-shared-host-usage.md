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

- [Deployments Usage](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-usage.md)
  for the repo-wide reviewed deployment workflows across all provider families
- [NixOS Shared Host Setup](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-setup.md)
  for install details, alternate install modes, status, and uninstall
- [NixOS Shared Host Technician Checklist](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-technician-checklist.md)
  for the short SOP handoff path
- [Mini Shared-Dev Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/mini-deployment.md)
  for background on why `mini` is set up this way
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
  for the strict system rules behind these workflows
- [Vault Production Bootstrap Runbook](/Users/kiltyj/Code/bucknix-fresh/docs/vault-production-bootstrap.md)
  for the canonical Vault bring-up path when `mini` deploys need Vault-backed
  secrets

## Start Here For `mini` Setup

If you are setting up `mini` for the first time, start with this page.

Use this entry sequence:

1. stay on this page for the reviewed bring-up order and the first commands to
   care about
2. open [NixOS Shared Host Setup](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-setup.md)
   when you need the full install, status, uninstall, or alternate-install-mode
   reference
3. open [NixOS Shared Host Technician Checklist](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-technician-checklist.md)
   when you need the short SOP handoff
4. open [Mini Shared-Dev Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/mini-deployment.md)
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
3. wire `/etc/nixos/bucknix/nixos-shared-host/default.nix` into the
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
[Vault Production Bootstrap Runbook](/Users/kiltyj/Code/bucknix-fresh/docs/vault-production-bootstrap.md).

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
  --destination mini \
  --remote-repo-path /srv/common \
  --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json \
  --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime \
  --remote-records-root /var/lib/bucknix/nixos-shared-host/records \
  --ssh-mode ssh \
  --control-plane-url https://deploy.apps.kilty.io \
  --control-plane-token-env BNX_DEPLOY_CONTROL_PLANE_TOKEN
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
  The human-readable destination name stored in the profile. In this workflow it
  matches the host name.
- `--remote-repo-path /srv/common`
  The repo checkout on `mini` that remote deploy commands should use.
- `--remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json`
  The host state file used by the shared-host deployment backend.
- `--remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime`
  The root directory where runtime files are materialized on `mini`.
- `--remote-records-root /var/lib/bucknix/nixos-shared-host/records`
  The root directory where deployment records are stored on `mini`.
- `--ssh-mode ssh`
  Use normal SSH transport. This is the standard choice for the current
  reviewed workflow.
- `--control-plane-url https://deploy.apps.kilty.io`
  The hosted deployment service URL that laptop clients should call.
- `--control-plane-token-env BNX_DEPLOY_CONTROL_PLANE_TOKEN`
  The environment variable name that holds the deployment service token on the
  client machine or Jenkins worker.

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
- remote state path `/var/lib/bucknix/nixos-shared-host/platform-state.json`
- remote runtime root `/var/lib/bucknix/nixos-shared-host/runtime`
- remote records root `/var/lib/bucknix/nixos-shared-host/records`
- a `serviceClient` block with the deployment service URL and token env

## Run The Reviewed Remote Deploy

From a dev machine, if `./dist` is your built app output folder:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --artifact-dir ./dist
```

`--artifact-dir ./dist` is optional here. It is only needed if you want to use
that exact local build output folder.

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
deployment service recorded in the client profile.

Do not pass `--control-plane-url`, `--apply-host`, or `--apply-host-dry-run`
to those wrappers. They read that information from the installed profile.

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
artifact. For automation, omit `--text` to keep the machine-readable JSON
response.

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
URL and records the reviewer from the authenticated service session.

Approval keeps the same `deploy_run_id` and continues the existing run. If you
get `approval_no_longer_valid` or `unauthorized`, re-run `--status` on that
same `deploy_run_id` and confirm the current approval fields before trying
again.
