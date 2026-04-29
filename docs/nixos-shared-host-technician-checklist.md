# NixOS Shared Host Technician Checklist

This is the short technician checklist for the supported `mini` workflow.

Use [NixOS Shared Host Usage](nixos-shared-host-usage.md)
for the operator-facing workflow and
[NixOS Shared Host Setup](nixos-shared-host-setup.md)
for the fuller install reference.

Current supported scope:

- provider family: `nixos-shared-host`
- example shared host: `mini`
- component kinds:
  - `static-webapp`
  - `ssr-webapp` for the reviewed single-component host slice
- protection class: `shared_nonprod`

## Before You Start

Confirm all of these before making changes:

- `mini` is a NixOS machine
- `/etc/nix/nix.conf` on `mini` already enables `nix-command` and `flakes`
- the reviewed repo checkout on `mini` exists at `/srv/common`
- the authoritative config root on `mini` is `/etc/nixos`
- the authoritative config entry on `mini` is `/etc/nixos/flake.nix` when it
  exists, otherwise `/etc/nixos/configuration.nix`
- each dev machine or Jenkins worker that will run deploys has its own repo
  checkout
- client machines can reach `mini` over the reviewed SSH path

If any input is wrong, stop and ask for help rather than inventing a new path.

## Server Setup On `mini`

Run from the repo checkout on `mini`:

```bash
cd /srv/common
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  server install
```

Expected files and directories:

- `/etc/nixos/deployment-host/install-manifest.json`
- `/etc/nixos/deployment-host/deployment-host-managed.nix`
- `/etc/nixos/deployment-host/default.nix`
- flake-evaluated persistent state: `/etc/nixos/deployment-host/platform-state.json`
- persistent runtime data: `/var/lib/deployment-host/runtime`
- persistent deployment records: `/var/lib/deployment-host/records`

Before rebuilding a flake host, confirm `/etc/nixos/flake.nix` exposes the
module directory as `deploymentModulesRoot`; the generated
`deployment-host-managed.nix` imports
`"${deploymentModulesRoot}/nixos-shared-host-module.nix"` and should not require
`--impure`.
Keep secrets out of `platform-state.json`; it is read by Nix during pure flake
evaluation.

## Wire And Verify The Host

Add the managed anchor to the authoritative config entry. On flake hosts, this
is usually the `modules` list in `/etc/nixos/flake.nix`:

```nix
modules = [
  ./hardware-configuration.nix
  /etc/nixos/deployment-host/default.nix
];
```

Apply the host config:

```bash
sudo nixos-rebuild switch
```

Then verify the install:

```bash
cd /srv/common
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  server status
```

Completion criteria:

- `managed` is `true`
- `wiringState` is `wired`
- the managed paths still exist

## Start The Deployment Service

Run on `mini` from `/srv/common`:

```bash
export BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL='postgres://deployctl:REDACTED@127.0.0.1:5432/deployctl'
export BNX_DEPLOY_CONTROL_PLANE_TOKEN='replace-me'
set -a
. /etc/deployment-host/reviewed-source-ssh.env
set +a
direnv exec . zx-wrapper build-tools/tools/deployments/nixos-shared-host-control-plane-service.ts \
  --host-root /var/lib/deployment-host/runtime \
  --state /etc/nixos/deployment-host/platform-state.json \
  --records-root /var/lib/deployment-host/records \
  --host 127.0.0.1 \
  --port 7780
```

```bash
direnv exec . zx-wrapper build-tools/tools/deployments/nixos-shared-host-control-plane-worker.ts \
  --records-root /var/lib/deployment-host/records
```

What success looks like:

- the service binds successfully
- the worker stays running
- both processes use the same Postgres URL
- both processes load `/etc/deployment-host/reviewed-source-ssh.env`, which
  points at the host-managed GitHub SSH deploy key for the private reviewed repo
- worker-side Vault credential variables are present only on `mini`, and
  fixture paths or laptop Vault token/JWT variables are not exported into the
  service submission path
- operators know that normal inspection stays on the service, keyed by
  `submissionId` or `deployRunId`
- operators know `pending_approval` runs are resumed with the `approve` action
  on the existing `deploy_run_id`

## Client Setup

Run from each dev machine or Jenkins worker:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  client install \
  --profile mini \
  --control-plane-url https://deploy.apps.kilty.io
```

The installed profile should be here:

- `.local/deployments/nixos-shared-host/clients/mini.json`
- `--control-plane-token-env BNX_DEPLOY_CONTROL_PLANE_TOKEN` is the default;
  the profile stores the env var name, not the token value

What success looks like:

- the `mini` profile is listed by `client list`
- the profile points at `/srv/common`
- the profile points at the reviewed remote state, runtime, and records paths
- the profile stores the deployment service endpoint and token-env binding

## Approval SOP

If a run enters `lifecycleState = pending_approval`, approve that same run
instead of submitting a new one. First inspect the run:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --status \
  --deploy-run-id "$DEPLOY_RUN_ID"
```

Then approve it:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --approve \
  --deploy-run-id "$DEPLOY_RUN_ID" \
  --approval-id ticket-123
```

For auth-required protected/shared runs, the service opens or prints the login
URL and records the approver from the authenticated service session.
Treat `--mark-check-passed` as an authorized shortcut, not a bypass:
the same principal still needs `submitter` to start the deploy and
`admission_reporter` to assert checks.

Before approving, check at least:

- `status.approval.state = pending`
- `status.approval.payloadFingerprint` matches the reviewed payload
- `status.approval.targetIdentity` matches the intended target
- `status.approval.provisionerPlanFingerprint` still matches when provisioning
  is in scope

The helper reads the current status first and copies those approval bindings
for you.

Approval keeps the same `deploy_run_id`. If you get
`approval_no_longer_valid` or `unauthorized`, stop and investigate.
For `unauthorized`, distinguish missing `submitter`, missing
`admission_reporter`, and missing `approver` access from the rejection text
before retrying anything.

## Final Handoff Check

Before handing the system back:

1. `server status` on `mini` reports `managed: true`
2. `server status` on `mini` reports `wiringState: wired`
3. each required client machine has a local `mini` profile installed
4. each client machine can render the remote plan:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --plan
```

The remote-profile and Jenkins wrappers use the service endpoint from
the installed client profile. They do not accept `--control-plane-url`,
`--apply-host`, or `--apply-host-dry-run` on the wrapper CLI.
