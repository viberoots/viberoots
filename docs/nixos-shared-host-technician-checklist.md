# NixOS Shared Host Technician Checklist

This is the short technician SOP for setting up `mini` as the current reviewed
`nixos-shared-host` server and installing the matching client profile on a dev
machine or CI worker.

Use [NixOS Shared Host Setup](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-setup.md)
as the canonical reference when you need more background, alternate install
modes, uninstall steps, or deploy-flow detail. This checklist is intentionally
short and follows the recommended default path only.

Current reviewed scope for this checklist:

- host/provider family: `nixos-shared-host`
- example shared host: `mini`
- component kinds:
  - `static-webapp`
  - `ssr-webapp` for the reviewed single-component host slice
- protection class: `shared_nonprod`

This checklist still uses the current Pleomino static deployment as the
concrete example, but the same server install, client-profile install, and
control-plane bring-up also support the reviewed single-component
`ssr-webapp` slice.

## Before You Start

Confirm these inputs before making changes:

- `mini` is a NixOS machine
- `/etc/nix/nix.conf` on `mini` already enables `nix-command` and `flakes`
- the repo checkout that `mini` should use for reviewed remote deploys exists
  at `/srv/common`
- the authoritative NixOS config root on `mini` is `/etc/nixos`
- the authoritative NixOS config entry on `mini` is
  `/etc/nixos/configuration.nix`
- each client machine that will run deploys has its own repo checkout
- client machines can reach `mini` over the reviewed SSH path

If any of those assumptions are wrong, stop and escalate rather than inventing
an alternate setup.

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

Expected managed assets:

- `/etc/nixos/bucknix/nixos-shared-host/install-manifest.json`
- `/etc/nixos/bucknix/nixos-shared-host/nixos-shared-host-managed.nix`
- `/etc/nixos/bucknix/nixos-shared-host/default.nix`
- `/var/lib/bucknix/nixos-shared-host/platform-state.json`
- `/var/lib/bucknix/nixos-shared-host/runtime`
- `/var/lib/bucknix/nixos-shared-host/records`

## Wire The Host Config

Add the managed anchor to `/etc/nixos/configuration.nix`:

```nix
imports = [
  ./hardware-configuration.nix
  /etc/nixos/bucknix/nixos-shared-host/default.nix
];
```

If the host uses a flake-style config entry instead of a plain
`configuration.nix`, add the same anchor path to the top-level
`modules = [ ... ]` list.

Apply the host config:

```bash
sudo nixos-rebuild switch
```

## Verify The Server

Run:

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
- the managed paths listed above still exist

If `wiringState` is `missing` or `unknown`, stop and escalate.

## Start The Control Plane

Run on `mini` from `/srv/common` in two long-running shells or services:

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

Completion criteria:

- the service reports a bound URL on stdout
- the worker stays running without immediate error
- both processes use the same reviewed Postgres URL from `BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL`
- operators know the reviewed Postgres backend is authoritative for claimed-running ownership, status/result reads, and protected/shared deploy records
- operators treat `<records-root>/control-plane/*.json` and `<records-root>/runs/*.json` as mirrors for inspection and restore testing rather than the sole source of truth during recovery
- operators know that `pending_approval` runs are resumed with the reviewed
  `approve` run action on the existing `deploy_run_id`, not by resubmitting the
  deploy request

## Client Setup

Run from a repo checkout on each dev machine or CI worker that should target
`mini`:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  client install \
  --profile mini \
  --destination mini \
  --remote-repo-path /srv/common \
  --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json \
  --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime \
  --remote-records-root /var/lib/bucknix/nixos-shared-host/records \
  --ssh-mode ssh
```

The installed local client manifest should be:

- `.local/deployments/nixos-shared-host/clients/mini.json`

Optional verification:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install client list
```

Completion criteria:

- the `mini` profile is listed
- the profile points at `/srv/common`
- the profile points at the reviewed remote state, runtime, and records paths

## Final Technician Handoff Check

Before handing the system back:

1. `server status` on `mini` reports `managed: true`
2. `server status` on `mini` reports `wiringState: wired`
3. each required client machine has a local `mini` profile installed
4. each client machine can render the reviewed remote plan:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --plan
```

The plan must resolve to:

- destination `mini`
- remote repo path `/srv/common`
- remote state path `/var/lib/bucknix/nixos-shared-host/platform-state.json`
- remote runtime root `/var/lib/bucknix/nixos-shared-host/runtime`
- remote records root `/var/lib/bucknix/nixos-shared-host/records`

If the plan shows different remote paths, stop and escalate.

If an operator will run shared-host mutation directly on `mini`, also confirm
the reviewed same-host service path works from the repo checkout that started
the service, for example:

```bash
cd /srv/common
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --control-plane-url http://127.0.0.1:7780
```

Remote-profile and Jenkins wrapper flows still use the reviewed SSH transport
for artifact staging and remote preflight, but they submit the protected/shared
mutation through the control-plane service endpoint recorded in the reviewed
client profile. They do not accept `--control-plane-url` on the wrapper CLI;
confirm the selected profile already carries the correct service endpoint and
token-env configuration before proceeding.
