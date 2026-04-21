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

If `mini`-targeted deployments need Vault-backed secrets, also open
[Vault Production Bootstrap Runbook](/Users/kiltyj/Code/bucknix-fresh/docs/vault-production-bootstrap.md).
That runbook is the canonical Vault setup path. This setup guide covers the
shared-host install and control-plane bring-up on `mini`, not Vault bootstrap
itself.

For repo-managed local Vault support on `mini`, the reviewed optional service
modules live at:

- `/srv/common/build-tools/tools/nix/shared-host-identity-provider-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-postgres-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-vault-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-deploy-auth-callback-module.nix`

The Vault runbook shows how to use the identity-provider module and the
reviewed deploy auth diagnostics. Its `deploy-vault-jwt` helper remains
available for low-level token smoke/debug checks, but normal deploys should let
the deploy front door choose the credential source and keep workload JWTs in
memory for local/direct runs. For protected service-backed runs, configure the
deployment worker with the server-local credential source environment variables
or files named by `vault_runtime`; the client must not submit Vault JWTs,
Vault tokens, provider secrets, PKCE verifiers, or client secrets.

Current supported scope:

- provider family: `nixos-shared-host`
- component kinds:
  - `static-webapp`
  - `ssr-webapp` for the reviewed single-component host slice
- protection class: `shared_nonprod`
- example deployment: `//projects/deployments/pleomino-dev:deploy`

## When Vault Is In Scope

Use this setup guide for the `mini` host install, config wiring, control-plane
service, worker, and client profile.

Use [Vault Production Bootstrap Runbook](/Users/kiltyj/Code/bucknix-fresh/docs/vault-production-bootstrap.md)
for Vault itself.

That is the right next document whether:

- Vault runs on `mini`
- Vault runs on another machine or cluster that `mini`-targeted deployments
  consume

In other words:

- `nixos-shared-host-setup.md` explains how to set up the shared-host deploy
  platform on `mini`
- `vault-production-bootstrap.md` explains how to set up the Vault backend for
  deployment secrets

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

In plain language, `managed-manual-wire` means:

- the installer writes and owns its managed files under
  `/etc/nixos/bucknix/nixos-shared-host`
- the installer creates the platform-state, runtime, and records paths it owns
- the installer does not edit `/etc/nixos/configuration.nix` or your flake entry
- you add the `/etc/nixos/bucknix/nixos-shared-host/default.nix` import or
  module entry yourself

Use `managed-dropin` only if you want the installer to update the config entry
for you. Use `emit-only` only when you want to inspect the generated snippets
without changing the host.

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

Here, "managed" means "owned by the installer and tracked in
`install-manifest.json`". Uninstall removes only those managed files and
directories.

`managed-manual-wire` is the default because it leaves the authoritative NixOS
config entry under your control while still letting the installer manage its own
files and runtime directories.

## What `--install-mode` Means

The installer supports three values:

- `managed-manual-wire`
  Recommended default for `mini`. The installer writes the managed files,
  creates the state/runtime/records paths, and records them in the install
  manifest. It does not edit the config entry. After install, `server status`
  reports `managed = true` and `wiringState = missing` until you add the anchor
  import and run `nixos-rebuild switch`.
- `managed-dropin`
  Hands-off managed install. The installer writes the managed files, creates the
  state/runtime/records paths, and also edits the config entry you pass in
  `--config-entry-path` so the anchor is already wired. After install, `server
status` should report `managed = true` and usually `wiringState = wired`
  immediately.
- `emit-only`
  Preview mode. The installer does not write the managed files, does not create
  state/runtime/records paths, and does not edit the config entry. Instead, it
  prints the generated snippet paths, snippet contents, and the instruction that
  tells you what to wire by hand.

Which mode to choose:

- choose `managed-manual-wire` when you want the reviewed `mini` path and you
  want to keep the main NixOS config under human review
- choose `managed-dropin` when you are comfortable letting the installer update
  the config entry automatically
- choose `emit-only` when you want to review the generated module and anchor
  before any host mutation

What the install flags mean:

- `--server-root /`
  The filesystem root of the host being configured. Use `/` for the normal
  local-machine install path.
- `--config-root /etc/nixos`
  The NixOS config root on `mini`.
- `--config-entry-path /etc/nixos/configuration.nix`
  The authoritative NixOS config entry that should import or include the shared
  host anchor. For `managed-dropin`, this flag is required because the installer
  edits that file directly. For `managed-manual-wire`, it is still useful
  because the installer records which file you intend to wire by hand.
- `--install-mode managed-manual-wire`
  Recommended default. The installer manages its own files and runtime
  directories, while you add the anchor import or module entry yourself.

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

This manual wiring step is exactly what makes `managed-manual-wire` "manual
wire": the installer emitted the anchor file, but you are the one who chooses
when to add it to the authoritative config entry.

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

Status field meanings:

- `managed = true`
  The installer found an install manifest and recognizes the host as one of its
  managed installs.
- `wiringState = wired`
  The config entry currently includes the generated anchor path.
- `wiringState = missing`
  The managed files exist, but the config entry does not currently include the
  anchor path. This is the expected intermediate state right after a fresh
  `managed-manual-wire` install and before you edit the config entry.
- `existingManagedPaths`
  The subset of installer-owned files and directories that still exist on disk.
  If some are missing, the install has drifted and should be inspected before
  further changes.

## Optional Importable Service Modules On `mini`

If you also want `mini` itself to run local Postgres and Vault services, the
repo now includes reviewed importable NixOS modules:

- `/srv/common/build-tools/tools/nix/shared-host-postgres-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-vault-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-deploy-auth-callback-module.nix`

Use these when the host keeps a checkout of this repo at `/srv/common` and you
want the service definitions versioned with the rest of the deployment system.
For a flake-based host, add `/srv/common/build-tools/tools/nix` as a non-flake
path input and import the modules through that input. Do not import
`/srv/common/...` as an absolute path from `configuration.nix`; pure flake
evaluation rejects that unless you rebuild with `--impure`. Do not point the
input at all of `/srv/common` unless you are comfortable copying the full repo
into the store during rebuilds.

These modules are intentionally opt-in. The shared-host installer does not
import them for you.

Example `flake.nix` wiring:

```nix
{
  inputs.deploymentModules = {
    url = "path:/srv/common/build-tools/tools/nix";
    flake = false;
  };

  outputs = { nixpkgs, deploymentModules, ... }@inputs: {
    nixosConfigurations.mini = nixpkgs.lib.nixosSystem {
      # Existing system and modules settings stay here.
      specialArgs = {
        # Existing specialArgs stay here.
        deploymentModulesRoot = deploymentModules;
      };
    };
  };
}
```

Example `configuration.nix` wiring:

```nix
{ config, lib, pkgs, deploymentModulesRoot, ... }:

{
  imports = [
    # Existing imports stay here.
    "${deploymentModulesRoot}/shared-host-postgres-module.nix"
    "${deploymentModulesRoot}/shared-host-vault-module.nix"
    "${deploymentModulesRoot}/shared-host-deploy-auth-callback-module.nix"
  ];
}
```

What these modules do:

- `shared-host-postgres-module.nix`
  Enables local PostgreSQL on `mini`, pins the reviewed package to
  `pkgs.postgresql_16`, binds it to `127.0.0.1:5432`, ensures the `deployctl`
  database exists, and ensures a matching `deployctl` role owns it.
- `shared-host-vault-module.nix`
  Enables local Vault on `mini`, allows the unfree `vault` package, uses the
  built-in `raft` storage backend at `/var/lib/vault`, and enables the local
  UI. When enabled without TLS options it binds Vault to `127.0.0.1:8200`; when
  the existing host config already owns the `*.apps.kilty.io` wildcard ACME
  certificate, set
  `deploymentHost.vault.useAcmeCertificate = true` and
  `deploymentHost.vault.address = "0.0.0.0:8200"` to run Vault as the direct TLS
  endpoint for `https://secrets.apps.kilty.io:8200`.
- `shared-host-deploy-auth-callback-module.nix`
  Adds the reviewed nginx route for the deployment service's OIDC callback
  endpoint. For `mini`, route `deploy-auth.apps.kilty.io` to the control-plane
  service's local `/oidc/callback` endpoint and keep that service port off the
  public firewall.

For hosts shaped like the current monolithic `mini` configuration, keep nginx,
ACME, DNS rewrites, and firewall list composition in the host file. Import the
modules, then set module ownership flags so they augment rather than replace the
host-owned config:

```nix
deploymentHost.vault = {
  enable = true;
  address = "0.0.0.0:8200";
  useAcmeCertificate = true;
  acmeCertName = "apps.kilty.io";
  acmeGroup = "apps-acme";
  publicHostname = "secrets.apps.kilty.io";
  openFirewall = false;
  addLocalHostname = true;
  apiAddress = "https://secrets.apps.kilty.io:8200";
  clusterAddress = "https://secrets.apps.kilty.io:8201";
};

deploymentHost.identityProvider = {
  enable = true;
  hostname = "identity.apps.kilty.io";
  keycloakHttpPort = 8091;
  manageNginx = false;
  manageAcme = false;
  openFirewall = false;
};

deploymentHost.deployAuthCallback = {
  enable = true;
  hostname = "deploy-auth.apps.kilty.io";
  callbackPath = "/oidc/callback";
  localBindHost = "127.0.0.1";
  localBindPort = 7780;
  manageNginx = false;
  manageAcme = false;
  openFirewall = false;
};
```

With that shape, add `8200` to the existing
`networking.firewall.allowedTCPPorts` expression and add a host-owned nginx
virtual host for `identity.apps.kilty.io` plus a host-owned callback vhost for
`deploy-auth.apps.kilty.io` that proxies to the deployment service and uses the
existing `apps.kilty.io` wildcard certificate. The Vault runbook has the full
copy/paste snippets.

What these modules do not do:

- initialize, unseal, or configure Vault auth, policy, KV mounts, or secrets
- set Postgres passwords for you
- start the deploy control-plane service or worker for you

Postgres follow-up after the first `nixos-rebuild switch`:

- set a password for the local `deployctl` database role
- export `BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL` using that credential before
  you start the service and worker

One reviewed example:

```bash
sudo -u postgres psql -c "ALTER ROLE deployctl WITH LOGIN PASSWORD 'replace-me';"
export BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL='postgres://deployctl:replace-me@127.0.0.1:5432/deployctl'
```

Vault follow-up after the first `nixos-rebuild switch`:

- use the local service as the installation and lifecycle owner
- then open [Vault Production Bootstrap Runbook](/Users/kiltyj/Code/bucknix-fresh/docs/vault-production-bootstrap.md)
  for init, unseal, audit, KV v2, JWT auth roles, policy, and secret bootstrap

The Vault module is a host-service baseline, not a substitute for the Vault
bootstrap runbook.

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
  --approval-id ticket-123
```

The helper reads the current status first and reuses the recorded
`payloadFingerprint`, `targetIdentity`, and `provisionerPlanFingerprint`
bindings automatically.
For auth-required protected/shared runs, the service opens or prints the login
URL and derives the approver from the authenticated service session.

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
  Use this when you want the installer to write and own its managed files, state
  file, runtime root, and records root, but you want to keep the main NixOS
  config entry under human control.
- `managed-dropin`: the installer also manages the config-entry wiring block
  Use this when you want a more hands-off install and are comfortable letting
  the installer edit the config entry for you.
- `emit-only`: show what would be installed without changing the host
  Use this when you want to inspect the generated module, anchor, and wiring
  instruction before making any changes on the machine.
