# NixOS Shared Host Setup

This is the install and maintenance reference for the supported
`nixos-shared-host` workflow on `mini`.

If you are looking for the first documentation entrypoint for setting up
`mini`, start with
[NixOS Shared Host Usage](nixos-shared-host-usage.md).
This page is the detailed install and maintenance reference that page sends you
to. Hand
[NixOS Shared Host Technician Checklist](nixos-shared-host-technician-checklist.md)
to technicians when they need the short SOP. Use
[Mini Shared-Dev Deployment Design](mini-deployment.md)
and [Deployment Contract](deployments-contract.md)
for deeper system rules.

If `mini`-targeted deployments need Vault-backed secrets, also open
[Vault Production Bootstrap Runbook](vault-production-bootstrap.md).
That runbook is the canonical Vault setup path. This setup guide covers the
shared-host install and control-plane bring-up on `mini`, not Vault bootstrap
itself.

For repo-managed local Vault support on `mini`, the reviewed optional service
modules live at:

- `/srv/common/build-tools/tools/nix/shared-host-identity-provider-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-postgres-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-vault-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-deployment-service-module.nix`
- `/srv/common/build-tools/tools/nix/shared-host-deploy-auth-callback-module.nix`

The Vault runbook shows how to use the identity-provider module and the
reviewed deploy auth diagnostics. Its `deploy-vault-jwt` helper remains
available for low-level token smoke/debug checks, but normal deploys should let
the deploy front door choose the credential source and keep workload JWTs in
memory for local/direct runs. For protected service-backed runs, configure the
deployment worker with the server-local credential source environment variables
or files named by `vault_runtime`; the client must not submit Vault JWTs,
Vault tokens, fixture paths, provider secrets, PKCE verifiers, requested
principals, authorization grants, or client secrets.

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

Use [Vault Production Bootstrap Runbook](vault-production-bootstrap.md)
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
2. run `server install` on `mini`
3. import `/etc/nixos/deployment-host/default.nix` into the
   authoritative NixOS config
4. run `sudo nixos-rebuild switch`
5. start the deployment service and worker
6. run `client install --profile mini` on each dev machine or Jenkins worker
7. render `deploy --profile mini --plan`
8. run the reviewed remote deploy flow
9. if the service returns `pending_approval`, approve the same frozen run on the
   existing `deploy_run_id`

In plain language, `managed-manual-wire` means:

- the installer writes and owns its managed files under
  `/etc/nixos/deployment-host`
- the installer creates the flake-evaluated platform state at
  `/etc/nixos/deployment-host/platform-state.json` and runtime/records roots
  under `/var/lib/deployment-host`; all three are persistent host data
- the installer does not edit `/etc/nixos/configuration.nix` or your flake entry
- you add the `/etc/nixos/deployment-host/default.nix` import or
  module entry yourself

Use `managed-dropin` only if you want the installer to update the config entry
for you. Use `emit-only` only when you want to inspect the generated snippets
without changing the host.

## Server Install On `mini`

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
- `/etc/nixos/deployment-host/platform-state.json`
- `/var/lib/deployment-host/runtime`
- `/var/lib/deployment-host/records`

`/etc/nixos/deployment-host/platform-state.json` is intentionally beside the
generated Nix module because the module reads it during flake evaluation. Keep
secrets out of that file. `/var/lib/deployment-host` remains the canonical root
for runtime materialization, deployment records, and the deployment service home
on every host. The generated `deployment-host-managed.nix` imports the
shared-host module via `"${deploymentModulesRoot}/nixos-shared-host-module.nix"`,
so flake-based hosts must expose `build-tools/tools/nix` as a flake-visible
`deploymentModulesRoot` before running `nixos-rebuild switch --flake`.

Here, "managed" means "generated by the installer under
`/etc/nixos/deployment-host` and tracked in `install-manifest.json`".
Uninstall removes only those generated config files and directories. It does
not remove `/var/lib/deployment-host`, deployment records, runtime material, or
secret-adjacent files.

`managed-manual-wire` is the default because it leaves the authoritative NixOS
config entry under your control while still letting the installer manage its own
generated config files.

## What `--install-mode` Means

The installer supports three values:

- `managed-manual-wire`
  Recommended default for `mini`. The installer writes the managed files,
  creates the state/runtime/records locations, and records their paths in the
  install manifest. Those backend locations are persistent host data, not
  uninstall-managed config inventory. It does not edit the config entry. After
  install, `server status` reports `managed = true` and `wiringState = missing`
  until you add the anchor import and run `nixos-rebuild switch`.
- `managed-dropin`
  Hands-off managed install. The installer writes the managed files, creates the
  state/runtime/records locations, and also edits the config entry you pass in
  `--config-entry-path` so the anchor is already wired. The backend locations
  remain persistent host data. After install, `server status` should report
  `managed = true` and usually `wiringState = wired` immediately.
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
  The filesystem root of the host being configured. Defaults to `/`, the normal
  local-machine install path.
- `--config-root /etc/nixos`
  The NixOS config root on `mini`. Defaults to `/etc/nixos`.
- `--config-entry-path /etc/nixos/configuration.nix`
  The authoritative NixOS config entry that should import or include the shared
  host anchor. If omitted, the installer checks for `${configRoot}/flake.nix`
  first and falls back to `${configRoot}/configuration.nix`. Pass this flag
  only when you need to override that detected entry.
- `--install-mode managed-manual-wire`
  Recommended default and the value used when the flag is omitted. The
  installer manages its own files and runtime directories, while you add the
  anchor import or module entry yourself.

## Wire And Verify The Host Config

Add the managed anchor to the authoritative config entry:

```nix
imports = [
  ./hardware-configuration.nix
  /etc/nixos/deployment-host/default.nix
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
  server status
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
- `/srv/common/build-tools/tools/nix/shared-host-deployment-service-module.nix`
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
    "${deploymentModulesRoot}/shared-host-deployment-service-module.nix"
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
- `shared-host-deployment-service-module.nix`
  Adds the reviewed nginx route for the hosted deployment service API. For
  `mini`, route `deploy.apps.kilty.io` to the control-plane service's private
  `127.0.0.1:7780` listener. The module rejects wildcard backend binds so the
  worker/service port is not exposed directly.
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
  generatedImportRoot = "/srv/common/deployment-host/identity-provider";
  manageNginx = false;
  manageAcme = false;
  openFirewall = false;
};

deploymentHost.deploymentService = {
  enable = true;
  hostname = "deploy.apps.kilty.io";
  localBindHost = "127.0.0.1";
  localBindPort = 7780;
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

Before you rebuild, generate the reviewed Keycloak group shape with:

```bash
direnv exec . build-tools/tools/bin/deploy admin keycloak sync \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --realm-file ./deployment-host/identity-provider/deployment-auth-realm.json \
  --acting-principal <principal> \
  --admin-group deploy-admin-keycloak-shape-admin-project-pleomino
```

`deploymentHost.identityProvider.generatedImportRoot` is the reviewed
host-module surface for these mutable generated files. The module bootstraps
empty JSON if the files do not exist yet, then runtime-links them into
Keycloak's import directory during activation. Keep both files gitignored; do not
list them in `deploymentHost.identityProvider.realmFiles`, which is reserved
for static flake-visible imports. Treat the generated realm file as group shape
and mapper configuration only; keep human and automation membership in the
separate generated input `./deployment-host/identity-provider/deployment-auth-memberships.json`.
One reviewed membership grant example is:

```bash
direnv exec . build-tools/tools/bin/deploy admin keycloak grant-user \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --action submit \
  --user-email alice@example.com \
  --membership-file ./deployment-host/identity-provider/deployment-auth-memberships.json \
  --acting-principal <principal> \
  --admin-group deploy-admin-keycloak-membership-admin-project-pleomino
```

From a reviewed client machine, the same artifacts can be updated without a
manual SSH session:

```bash
direnv exec . build-tools/tools/bin/deploy admin keycloak sync \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --acting-principal <principal> \
  --admin-group deploy-admin-keycloak-shape-admin-project-pleomino \
  --apply-host-dry-run

direnv exec . build-tools/tools/bin/deploy admin keycloak grant-user \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --action submit \
  --user-email alice@example.com \
  --acting-principal <principal> \
  --admin-group deploy-admin-keycloak-membership-admin-project-pleomino \
  --apply-host
```

That reviewed remote path writes the authoritative realm files under the host
config root, keeps flake evaluation pure, and then optionally runs the
preflighted host-apply helper instead of relying on hand-edited files under
`/srv/common`.

The reviewed deploy-admin Keycloak grants stay separate from ordinary deploy
grants. Typical examples are:

- `deploy-admin-keycloak-read-project-pleomino`
- `deploy-admin-keycloak-shape-admin-project-pleomino`
- `deploy-admin-keycloak-membership-admin-project-pleomino`

With that shape, add `8200` to the existing
`networking.firewall.allowedTCPPorts` expression and add host-owned nginx
virtual hosts for `identity.apps.kilty.io`, `deploy.apps.kilty.io`, and
`deploy-auth.apps.kilty.io`. The deployment-service vhost proxies `/` to
`http://127.0.0.1:7780`; the deploy-auth vhost proxies `/oidc/callback` to the
same private service listener. Both deployment vhosts use the existing
`apps.kilty.io` wildcard certificate. The Vault runbook has the full
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
- then open [Vault Production Bootstrap Runbook](vault-production-bootstrap.md)
  for init, unseal, audit, KV v2, JWT auth roles, policy, and secret bootstrap

The Vault module is a host-service baseline, not a substitute for the Vault
bootstrap runbook.

## Start The Deployment Service

Run these long-lived processes on `mini` from `/srv/common`.

Plain-language version:

- the service accepts deployment requests and answers status queries
- the worker picks up accepted requests and performs the actual work
- uploaded artifacts, admitted artifacts, auth sessions, status, and records are
  stored under the configured records root or the backend database before any
  provider mutation starts
- worker-side Vault credentials come from server-local env/file references or a
  reviewed workload identity source on `mini`, never from the laptop request

What the service and worker flags mean:

- `--host-root /var/lib/deployment-host/runtime`
  The runtime root on `mini`.
- `--state /etc/nixos/deployment-host/platform-state.json`
  The shared-host state file.
- `--records-root /var/lib/deployment-host/records`
  The records directory on `mini`. This root also contains retained upload and
  admitted-artifact storage used by the hosted service.
- `--artifact-staging-root /var/lib/deployment-host/runtime/.deploy-artifacts`
  The only root from which protected/shared staged artifacts are admitted. The
  service canonicalizes finalized artifact paths under this root and rejects
  mutable, incomplete, or escaping trees before hashing and storage.
- `--control-plane-database-url "$BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL"`
  The Postgres URL both processes use.
- `--port 7780`
  The TCP port where the deployment service listens.
- `--host 127.0.0.1`
  The private bind address. Keep the service on loopback and expose it only
  through the reviewed HTTPS nginx vhost.
- `BNX_DEPLOY_CONTROL_PLANE_TOKEN='replace-me'`
  Required for the reviewed hosted service. The service startup fails closed without a bearer token unless `BNX_DEPLOY_LOCAL_FIXTURE_SERVICE=1` explicitly marks a local fixture service.
- `BNX_DEPLOY_GITHUB_TOKEN='replace-me'`
  Required when the hosted service must verify GitHub-backed lane governance
  automatically during protected/shared admission. The service reads live
  branch-protection state with this token and fails closed if governance
  verification is required but the token is unavailable.

Common example values:

- `BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL='postgres://deployctl:REDACTED@127.0.0.1:5432/deployctl'`
- `--port 7780`
- service URL from another machine:
  `https://deploy.apps.kilty.io`
- service URL on `mini` itself:
  `http://127.0.0.1:7780` only with `BNX_DEPLOY_LOCAL_FIXTURE_SERVICE=1`
  for local fixture flows. Laptop and CI profiles use HTTPS, and manifest or
  flag based loopback HTTP is rejected unless that fixture marker is present.

```bash
export BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL='postgres://deployctl:REDACTED@127.0.0.1:5432/deployctl'
export BNX_DEPLOY_CONTROL_PLANE_TOKEN='replace-me'
export BNX_DEPLOY_GITHUB_TOKEN='replace-me'
direnv exec . zx-wrapper build-tools/tools/deployments/nixos-shared-host-control-plane-service.ts \
  --host-root /var/lib/deployment-host/runtime \
  --state /etc/nixos/deployment-host/platform-state.json \
  --records-root /var/lib/deployment-host/records \
  --artifact-staging-root /var/lib/deployment-host/runtime/.deploy-artifacts \
  --host 127.0.0.1 \
  --port 7780
```

```bash
direnv exec . zx-wrapper build-tools/tools/deployments/nixos-shared-host-control-plane-worker.ts \
  --records-root /var/lib/deployment-host/records
```

Required worker-side secret-source prep after PR-79 and later:

- set `BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL` for both service and worker
- set `BNX_DEPLOY_CONTROL_PLANE_TOKEN` or pass `--token` for the reviewed
  hosted service; unconfigured hosted protected/shared routes fail closed, and
  tokenless startup is reserved for explicit fixture mode only
- set `BNX_DEPLOY_GITHUB_TOKEN` when the hosted service must verify GitHub lane
  governance automatically; unsupported SCM backends still require reviewed
  explicit governance evidence through `--admission-evidence-json`
- set the server-local credential variable referenced by `vault_runtime`, for
  example `BNX_DEPLOYER_CLIENT_SECRET` for a reviewed service-account client
  secret, or `BNX_DEPLOYMENT_OIDC_TOKEN` for an external workload identity
  token
- keep `BNX_DEPLOYMENT_SECRET_FIXTURE_PATH`, ambient Vault JWTs, ambient Vault
  tokens, provider tokens, PKCE verifiers, and client secrets out of both the
  protected/shared client submission and the worker process environment unless a
  reviewed server-local credential source explicitly names the variable
- keep `NODE_TLS_REJECT_UNAUTHORIZED=0` and `BNX_DEPLOY_INSECURE_TLS=1` out of
  protected/shared client environments. The client fails closed if TLS
  validation is disabled.
- rely on the service-owned auth session for the human principal; protected/shared
  service submissions reject client-supplied `requestedBy` and authorization
  grants

Deploy auth sessions derive multiple grants from reviewed OIDC claims instead
of synthesizing one grant from the requested operation. Human deployment access
derives deployment-scoped grants from `deploy-submitters-<project>-<env>`,
`deploy-approvers-<project>-<env>`, and
`deploy-admission-reporters-<project>-<env>`. Reviewed automation principals
such as Jenkins may also derive broader scoped grants from groups like
`deploy-automation-<principal>-submitters-<env>` and
`deploy-automation-<principal>-admission-reporters-all-deployments`.

When you check status later, use the service and the IDs it returns:
`submissionId` and `deployRunId`.

## Install A Client Profile

Run from each dev machine or Jenkins worker that will target `mini`:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  client install \
  --profile mini \
  --control-plane-url https://deploy.apps.kilty.io
```

The client profile is written here:

- `.local/deployments/nixos-shared-host/clients/mini.json`

Optional verification:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install client list
```

If the output includes `invalidProfiles`, remove stale entries with
`direnv exec . build-tools/tools/bin/nixos-shared-host-install client uninstall --profile <name>`.

Common example values for the client-install flags:

- `--profile mini`
- `--destination mini`
  Defaults to the profile name. Override only when the destination label should
  differ from the local profile name.
- `--remote-repo-path /srv/common`
  Default value. Override only when the checkout on the host lives elsewhere.
- `--remote-state-path /etc/nixos/deployment-host/platform-state.json`
  Default value. The state file is flake-visible and must not contain secrets.
- `--remote-runtime-root /var/lib/deployment-host/runtime`
  Default value. Runtime materialization lives under the canonical
  deployment-host data root.
- `--remote-records-root /var/lib/deployment-host/records`
  Default value. Deployment records live under the canonical deployment-host
  data root.
- `--ssh-mode ssh`
  Default value. Selects the SSH transport for remote command execution.
  Override only if a future reviewed transport mode exists.
- `--control-plane-url https://deploy.apps.kilty.io`
- `--control-plane-token-env BNX_DEPLOY_CONTROL_PLANE_TOKEN`
  Default value. This stores the environment variable name in the profile; the
  token value itself stays outside the profile.

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
- an artifact stage root under the remote runtime root

Deploy from a dev machine:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  client install \
  --profile mini \
  --ssh-identity-file "$HOME/.ssh/mini-deploy" \
  --ssh-known-hosts "$HOME/.ssh/mini-known-hosts"

direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --artifact-dir ./dist
```

`--artifact-dir ./dist` is optional. In the reviewed profile workflow it names a
local source folder for staging or upload; it is not submitted to the hosted
service as a trusted laptop path. The service works from the `mini`-side staged
or admitted artifact before provider mutation.

If you leave it out, the deploy command uses the deployment target metadata to
build and locate the artifact automatically.

If the reviewed client profile stores `--ssh-identity-file` and
`--ssh-known-hosts`, remote-profile deploy uses those as explicit defaults.
Client install can also infer those once from `~/.ssh/config` for the selected
destination, or from a single standard `~/.ssh/id_ed25519`/`id_ecdsa`/`id_rsa`
plus `~/.ssh/known_hosts` when the choice is unambiguous, and then persist the
resolved paths into the reviewed profile.
You can still override them for one run with
`BNX_REMOTE_SSH_IDENTITY_FILE` and `BNX_REMOTE_SSH_KNOWN_HOSTS_FILE`.
Deploy itself does not guess from generic `~/.ssh` defaults, and install fails
closed when multiple plausible SSH files exist.

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
They require reviewed SSH trust material such as `--ssh-known-hosts` plus the
identity file. The rsync upload lands in a temporary directory under the staging
root, the remote side finalizes it with an atomic rename and completion marker,
and the service admits only the finalized immutable tree.

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
For submit-time check evidence, `--mark-check-passed` is only an authorized shortcut.
The authenticated principal still needs `submitter` to request the deploy and
`admission_reporter` to assert checks for that scope.
Before the first protected/shared submit, run
`direnv exec . build-tools/tools/bin/deploy --deployment <label> --validate-only`
and inspect `admissionRequirements.admission_policy`, `allowed_refs`,
`required_checks`, and `required_approvals`. That read-only output tells you
which reviewed names the deployment expects; it does not grant
`admission_reporter`.

Approval keeps the same `deploy_run_id`. If you get
`approval_no_longer_valid` or `unauthorized`, stop and investigate rather than
trying random retries. Submit failures now distinguish missing `submitter`
access from missing `admission_reporter` access, and approval failures still
point at missing `approver` access.

## Other Lifecycle Commands

Inspect the install at any time:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  server status
```

Uninstall removes only the generated config files and directories owned by the
installer. It deliberately preserves `/var/lib/deployment-host`, including the
state file, runtime root, records root, retained artifacts, auth/session records,
and any secret-adjacent files:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  server uninstall
```

Install modes:

- `managed-manual-wire`: recommended default
  Use this when you want the installer to write and own its generated config
  files, create persistent backend data locations, and keep the main NixOS
  config entry under human control.
- `managed-dropin`: the installer also manages the config-entry wiring block
  Use this when you want a more hands-off install and are comfortable letting
  the installer edit the config entry for you.
- `emit-only`: show what would be installed without changing the host
  Use this when you want to inspect the generated module, anchor, and wiring
  instruction before making any changes on the machine.
