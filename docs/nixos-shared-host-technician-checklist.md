# NixOS Shared Host Technician Checklist

This is the short technician checklist for the supported `mini` workflow.

Use [NixOS Shared Host Usage](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-usage.md)
for the operator-facing workflow and
[NixOS Shared Host Setup](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-setup.md)
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
- the authoritative config entry on `mini` is `/etc/nixos/configuration.nix`
- each dev machine or Jenkins worker that will run deploys has its own repo
  checkout
- client machines can reach `mini` over the reviewed SSH path

If any input is wrong, stop and ask for help rather than inventing a new path.

## Server Setup On `mini`

Run from the repo checkout on `mini`:

```bash
cd /srv/common
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  server install \
  --server-root / \
  --config-root /etc/nixos \
  --config-entry-path /etc/nixos/configuration.nix \
  --install-mode managed-manual-wire
```

Expected files and directories:

- `/etc/nixos/bucknix/nixos-shared-host/install-manifest.json`
- `/etc/nixos/bucknix/nixos-shared-host/nixos-shared-host-managed.nix`
- `/etc/nixos/bucknix/nixos-shared-host/default.nix`
- `/var/lib/bucknix/nixos-shared-host/platform-state.json`
- `/var/lib/bucknix/nixos-shared-host/runtime`
- `/var/lib/bucknix/nixos-shared-host/records`

## Wire And Verify The Host

Add the managed anchor to `/etc/nixos/configuration.nix`:

```nix
imports = [
  ./hardware-configuration.nix
  /etc/nixos/bucknix/nixos-shared-host/default.nix
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
  server status \
  --server-root / \
  --config-root /etc/nixos
```

Completion criteria:

- `managed` is `true`
- `wiringState` is `wired`
- the managed paths still exist

## Start The Deployment Service

Run on `mini` from `/srv/common`:

```bash
export BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL='postgres://deployctl:REDACTED@127.0.0.1:5432/deployctl'
direnv exec . zx-wrapper build-tools/tools/deployments/nixos-shared-host-control-plane-service.ts \
  --host-root /var/lib/bucknix/nixos-shared-host/runtime \
  --state /var/lib/bucknix/nixos-shared-host/platform-state.json \
  --records-root /var/lib/bucknix/nixos-shared-host/records \
  --control-plane-database-url "$BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL" \
  --port 7780
```

```bash
direnv exec . zx-wrapper build-tools/tools/deployments/nixos-shared-host-control-plane-worker.ts \
  --records-root /var/lib/bucknix/nixos-shared-host/records \
  --control-plane-database-url "$BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL"
```

What success looks like:

- the service binds successfully
- the worker stays running
- both processes use the same Postgres URL
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
  --destination mini \
  --remote-repo-path /srv/common \
  --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json \
  --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime \
  --remote-records-root /var/lib/bucknix/nixos-shared-host/records \
  --ssh-mode ssh \
  --control-plane-url http://127.0.0.1:7780 \
  --control-plane-token-env BNX_DEPLOY_CONTROL_PLANE_TOKEN
```

The installed profile should be here:

- `.local/deployments/nixos-shared-host/clients/mini.json`

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
URL and records the reviewer from the authenticated service session.

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
