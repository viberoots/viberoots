# NixOS Shared Host Setup

This is the install and maintenance reference for the supported
`nixos-shared-host` workflow on `mini`.

If you are looking for the first documentation entrypoint for setting up
`mini`, start with
[NixOS Shared Host Usage](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-usage.md).
This page is the detailed install and maintenance reference that page sends you
to. Hand
[NixOS Shared Host Technician Checklist](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-technician-checklist.md)
to technicians when they need the short SOP. Use
[Mini Shared-Dev Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/mini-deployment.md)
and [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
for deeper system rules.

Current supported scope:

- provider family: `nixos-shared-host`
- component kinds:
  - `static-webapp`
  - `ssr-webapp` for the reviewed single-component host slice
- protection class: `shared_nonprod`
- example deployment: `//projects/deployments/pleomino-dev:deploy`

## Recommended Path For `mini`

The default reviewed path is:

1. prepare a repo checkout on `mini` at `/srv/common`
2. run `server install --install-mode managed-manual-wire` on `mini`
3. import `/etc/nixos/bucknix/nixos-shared-host/default.nix` into the
   authoritative NixOS config
4. run `sudo nixos-rebuild switch`
5. start the deployment service and worker
6. run `client install --profile mini --destination mini` on each dev machine
   or Jenkins worker
7. render `deploy --profile mini --plan`
8. run the reviewed remote deploy flow
9. if the service returns `pending_approval`, approve the same frozen run on the
   existing `deploy_run_id`

Use `managed-dropin` only if you want the installer to update the config-entry
block for you.

## Server Install On `mini`

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

`managed-manual-wire` is the default because it leaves
`/etc/nixos/configuration.nix` under your control while still letting the
installer manage its own files.

What the install flags mean:

- `--server-root /`
  The filesystem root of the host being configured. Use `/` for the normal
  local-machine install path.
- `--config-root /etc/nixos`
  The NixOS config root on `mini`.
- `--config-entry-path /etc/nixos/configuration.nix`
  The main NixOS config file that should import the shared-host module.
- `--install-mode managed-manual-wire`
  Recommended default. The installer manages its own files, while you add the
  import line yourself.

## Wire And Verify The Host Config

Add the managed anchor to the authoritative config entry:

```nix
imports = [
  ./hardware-configuration.nix
  /etc/nixos/bucknix/nixos-shared-host/default.nix
];
```

If the host uses a flake-style config entry, add the same anchor path to the
top-level `modules = [ ... ]` list instead.

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

What success looks like:

- `managed` is `true`
- `wiringState` is `wired`
- the managed paths listed above still exist

## Start The Deployment Service

Run these long-lived processes on `mini` from `/srv/common`.

Plain-language version:

- the service accepts deployment requests and answers status queries
- the worker picks up accepted requests and performs the actual work

What the service and worker flags mean:

- `--host-root /var/lib/bucknix/nixos-shared-host/runtime`
  The runtime root on `mini`.
- `--state /var/lib/bucknix/nixos-shared-host/platform-state.json`
  The shared-host state file.
- `--records-root /var/lib/bucknix/nixos-shared-host/records`
  The records directory on `mini`.
- `--control-plane-database-url "$BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL"`
  The Postgres URL both processes use.
- `--port 7780`
  The TCP port where the deployment service listens.

Common example values:

- `BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL='postgres://deployctl:REDACTED@127.0.0.1:5432/deployctl'`
- `--port 7780`
- service URL from another machine:
  `http://mini:7780`
- service URL on `mini` itself:
  `http://127.0.0.1:7780`

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

When you check status later, use the service and the IDs it returns:
`submissionId` and `deployRunId`.

## Install A Client Profile

Run from each dev machine or Jenkins worker that will target `mini`:

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

The client profile is written here:

- `.local/deployments/nixos-shared-host/clients/mini.json`

Optional verification:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install client list
```

Common example values for the client-install flags:

- `--profile mini`
- `--destination mini`
- `--remote-repo-path /srv/common`
- `--remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json`
- `--remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime`
- `--remote-records-root /var/lib/bucknix/nixos-shared-host/records`
- `--ssh-mode ssh`
- `--control-plane-url http://127.0.0.1:7780`
- `--control-plane-token-env BNX_DEPLOY_CONTROL_PLANE_TOKEN`

## Review The Remote Plan And Deploy

Plan from a dev machine:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --plan
```

The plan should show:

- the selected destination
- the repo path on `mini`
- the state, runtime, and records paths on `mini`
- a `serviceClient` block with the deployment service URL and token env

Deploy from a dev machine:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --artifact-dir ./dist
```

`--artifact-dir ./dist` is optional. Use it only when you want to point at one
specific local build output folder.

If you leave it out, the deploy command uses the deployment target metadata to
build and locate the artifact automatically.

Deploy from Jenkins:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-jenkins-deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --artifact-dir "$WORKSPACE/projects/apps/pleomino/dist" \
  --ssh-identity-file "$JENKINS_SSH_IDENTITY" \
  --ssh-known-hosts "$JENKINS_KNOWN_HOSTS"
```

The remote-profile and Jenkins wrappers submit through the deployment service
recorded in the client profile. They do not accept `--control-plane-url`,
`--apply-host`, or `--apply-host-dry-run` on the wrapper command line.

## Approve An Existing Waiting Run

If a run enters `lifecycleState = pending_approval`, do not resubmit it. First
inspect that same run:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --status \
  --deploy-run-id "$DEPLOY_RUN_ID"
```

Before approving, check at least:

- `status.approval.state = pending`
- `status.approval.payloadFingerprint`
- `status.approval.targetIdentity`
- `status.approval.provisionerPlanFingerprint` when provisioning is in scope

Then approve that same run:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --approve \
  --deploy-run-id "$DEPLOY_RUN_ID" \
  --approval-id ticket-123 \
  --requested-by-principal user:reviewer
```

The helper reads the current status first and reuses the recorded
`payloadFingerprint`, `targetIdentity`, and `provisionerPlanFingerprint`
bindings automatically.

Approval keeps the same `deploy_run_id`. If you get
`approval_no_longer_valid` or `unauthorized`, stop and investigate rather than
trying random retries.

## Other Lifecycle Commands

Inspect the install at any time:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  server status \
  --server-root / \
  --config-root /etc/nixos
```

Uninstall removes only the files and directories owned by the installer:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  server uninstall \
  --server-root / \
  --config-root /etc/nixos
```

Install modes:

- `managed-manual-wire`: recommended default
  Use this when you want the installer to manage its own files but you want to
  keep the main NixOS config entry under human control.
- `managed-dropin`: the installer also manages the config-entry wiring block
  Use this when you want a more hands-off install and are comfortable letting
  the installer update the config-entry wiring for you.
- `emit-only`: show what would be installed without changing the host
  Use this when you want to inspect or review the generated files before making
  changes on the machine.
