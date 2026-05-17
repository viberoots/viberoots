# `mini` Name-Migration Instructions

Aligns the `mini` shared-host deployment (server + local client profile) with
the completed repo rename from `bucknix`/`bnx`/`kiltyj/common` to
`viberoots`/`vbr`/`viberoots/viberoots`.

This document now has two scopes:

- Parts A-C preserve the original repo/name migration runbook for a host that
  is still running the pre-container control-plane service and worker.
- Part D is the current migration path for moving `mini` to the containerized
  deployment control plane. Use Part D before the first new `mini` setup that
  should run the reviewed control plane under Podman.

## What is stale

**Local client manifest** — `.local/deployments/nixos-shared-host/clients/mini.json`:

- `"remoteRepoPath": "/srv/common"` → `/srv/viberoots`
- `"controlPlaneTokenEnv": "BNX_DEPLOY_CONTROL_PLANE_TOKEN"` → `VBR_DEPLOY_CONTROL_PLANE_TOKEN`
- `"localManagedPaths": [".../bucknix-fresh/..."]` → path under `viberoots/`
- `"toolFingerprint"` is also stale and will be re-derived on regeneration

**Remote `mini` host** — the following surfaces still carry old names:

- repo checkout at `/srv/common` (should be `/srv/viberoots`)
- git remote `git@github.com:kiltyj/common.git` (should be `git@github.com:viberoots/viberoots.git`)
- deployment-service / worker shell env or systemd `EnvironmentFile` exporting `BNX_DEPLOY_*` instead of `VBR_DEPLOY_*`
- any `/etc/nixos/flake.nix` / `configuration.nix` import paths or `deploymentModulesRoot` inputs pointing at `/srv/common`
- the host-side `direnv` / `.envrc` cache for `/srv/common`

Persistent host state under `/var/lib/deployment-host/{runtime,records}`,
retained artifact storage, the control-plane database, current-stage-state
records, and `/etc/nixos/deployment-host/platform-state.json` do **not** embed
the repo path — they stay put across the rename. (See
[docs/nixos-shared-host-setup.md:113](docs/nixos-shared-host-setup.md).)

The containerized control plane deliberately uses new runtime paths under
`/var/lib/deployment-control-plane` and file-backed credentials under
`/run/deployment-control-plane/credentials`. Existing
`/var/lib/deployment-host` records are not imported automatically. Treat the
containerized cutover as a fresh control-plane runtime unless a separate state
migration plan has been reviewed.

## Preconditions

- Repo rename PRs (PR-1..PR-6 in [docs/repo-rename.md](docs/repo-rename.md)) are merged on `main`.
- GitHub repo `viberoots/viberoots` exists and accepts the existing deploy key
  used by `mini`. Verify locally: `ssh -T git@github.com` from `mini` returns
  successfully, and the key is registered on `viberoots/viberoots`.
- You have root SSH to `mini.home.kilty.io`.
- No deploy run is currently in `pending_approval`. Drain or approve in-flight
  runs first so the service can be stopped cleanly.
- A backup or restore point exists for the control-plane database and
  `/var/lib/deployment-host/records` before touching the host. The rename does
  not modify either surface, but current-stage-state, retained artifact
  references, submissions, and run records are the release-state authority and
  are cheap to verify before a host migration.

## Migration order

The remote host owns the source of truth at `/srv/viberoots` and the running
service. Migrate the **server first**, then regenerate the **local client
profile** so its `toolFingerprint` and defaults match the freshly-renamed
tool. Doing it in the opposite order leaves a client profile pointing at a
`/srv/viberoots` path that does not yet exist.

For the containerized control-plane cutover, finish any needed repo/name cleanup
first, then follow Part D. Do not restart the old TypeScript service and worker
after Part D is enabled; the Podman-backed NixOS module owns one service
container and two worker containers.

---

## Part A — Migrate the `mini` host

All commands run as root on `mini` unless noted.

### A1. Stop the deployment service and worker

Identify whichever launcher you are currently using (systemd unit, tmux
session, or screen) and stop both the control-plane service
(`nixos-shared-host-control-plane-service.ts`) and worker
(`nixos-shared-host-control-plane-worker.ts`). The control-plane database,
records root, retained artifacts, and current-stage-state files keep admitted
release state; you are stopping the processes, not the data.

### A2. Move the repo checkout from `/srv/common` to `/srv/viberoots`

Prefer a fresh clone, because the git history is already on GitHub and a
clean checkout sidesteps stale worktree config, `direnv` allow state, and any
local mutations that crept into `/srv/common`:

```bash
cd /srv
git clone git@github.com:viberoots/viberoots.git viberoots
chown -R root:root /srv/viberoots   # match prior ownership of /srv/common
```

Then archive (do not delete yet) the old checkout so you can roll back if
A5 fails:

```bash
mv /srv/common /srv/common.pre-rename.bak
```

If you would rather rename in place (faster, but inherits any local cruft):

```bash
mv /srv/common /srv/viberoots
cd /srv/viberoots
git remote set-url origin git@github.com:viberoots/viberoots.git
git fetch origin
git checkout main && git pull --ff-only
```

Verify the remote either way:

```bash
cd /srv/viberoots && git remote -v
# expect: origin  git@github.com:viberoots/viberoots.git (fetch/push)
```

### A3. Update the NixOS host config

Look for direct references to `/srv/common` or `kiltyj/common` in the
authoritative config entry:

```bash
grep -rn '/srv/common\|kiltyj/common' /etc/nixos/
```

Expected hits, with the change to make:

- `/etc/nixos/flake.nix` — the `deploymentModulesRoot` input (or any
  `path:/srv/common/...` / `git+ssh://.../kiltyj/common` input). Rewrite to
  `/srv/viberoots` or `viberoots/viberoots`.
- `/etc/nixos/configuration.nix` (or the file the flake's `modules` list
  imports) — any `import /srv/common/...` lines.
- Optional service modules from [docs/nixos-shared-host-setup.md:244](docs/nixos-shared-host-setup.md) (local Postgres, local Vault, nginx vhost wiring) if they reference the repo path.

Leave alone:

- `/etc/nixos/deployment-host/install-manifest.json`,
  `/etc/nixos/deployment-host/deployment-host-managed.nix`,
  `/etc/nixos/deployment-host/default.nix`, and
  `/etc/nixos/deployment-host/platform-state.json` — these are installer-managed
  and do not embed the repo path. The next `server install` (A5) will
  re-emit them with the current tool fingerprint.

Then update `flake.lock` if needed:

```bash
cd /etc/nixos
nix flake lock --update-input deploymentModulesRoot   # name may differ
```

### A4. Update service env vars (`BNX_*` → `VBR_*`)

The control-plane service reads its token from `VBR_DEPLOY_CONTROL_PLANE_TOKEN`
on startup ([build-tools/tools/deployments/nixos-shared-host-control-plane-service.ts:14](build-tools/tools/deployments/nixos-shared-host-control-plane-service.ts)). Find anywhere `BNX_*` still appears in the host's
service-start surface:

```bash
grep -rn 'BNX_' \
  /etc/systemd/system/ \
  /etc/deployment-host/ \
  /root \
  2>/dev/null
```

For each hit, rewrite the variable name (the token _value_ stays the same):

- `BNX_DEPLOY_CONTROL_PLANE_TOKEN` → `VBR_DEPLOY_CONTROL_PLANE_TOKEN`
- `BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL` → `VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL`
- `BNX_DEPLOY_GITHUB_TOKEN` → `VBR_DEPLOY_GITHUB_TOKEN`
- `BNX_DEPLOY_REVIEWED_SOURCE_SSH_*` → `VBR_DEPLOY_REVIEWED_SOURCE_SSH_*`
- `BNX_DEPLOY_LOCAL_FIXTURE_SERVICE` → `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE` (should not be set on `mini` anyway — it is fixture-only)
- any `BNX_DEPLOYER_*` / `BNX_DEPLOYMENT_*` workload-identity vars → `VBR_*`

Likely files:

- `/etc/deployment-host/reviewed-source-ssh.env` (sourced before service start in [docs/nixos-shared-host-setup.md:604](docs/nixos-shared-host-setup.md))
- any `*.service` or drop-in under `/etc/systemd/system/` for the deployment service / worker
- any hand-rolled `.envrc` or shell-rc on `mini` that exports these for an interactive operator session

Reload systemd if you edited a unit or `EnvironmentFile`:

```bash
systemctl daemon-reload
```

### A5. Rebuild NixOS and re-run server install

Apply the updated config:

```bash
cd /srv/viberoots
nixos-rebuild switch --flake /etc/nixos
```

Then re-run the server install from the new checkout so the install manifest's
`toolFingerprint` and module imports are reissued from the renamed tool:

```bash
cd /srv/viberoots
direnv exec . build-tools/tools/bin/nixos-shared-host-install server install
```

Verify:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install server status
# expect: managed = true, wiringState = wired
```

### A6. Restart the deployment service and worker

Restart with the new `VBR_*` env names. The example command form from
[docs/nixos-shared-host-setup.md:599](docs/nixos-shared-host-setup.md) is now
the source of truth. Confirm:

- the service binds on `127.0.0.1:7780`
- `journalctl` shows no `BNX_*` lookups and no `unauthorized` startup errors
- the worker stays running and uses the same DB URL as the service

### A7. Delete the backup checkout

After a successful end-to-end deploy run (Part C), remove the safety copy:

```bash
rm -rf /srv/common.pre-rename.bak
```

---

## Part B — Regenerate the local client profile

Run on your workstation (not on `mini`) from `/Users/kiltyj/Code/viberoots`.

### B1. Uninstall the stale `mini` profile

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  client uninstall --profile mini
```

This removes `.local/deployments/nixos-shared-host/clients/mini.json` cleanly
(see [docs/nixos-shared-host-setup.md:682](docs/nixos-shared-host-setup.md)).

### B2. Reinstall the `mini` profile using current tool defaults

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  client install \
  --profile mini \
  --destination root@mini.home.kilty.io \
  --control-plane-url https://deploy.apps.kilty.io \
  --ssh-identity-file "$HOME/.ssh/id_rsa" \
  --ssh-known-hosts "$HOME/.ssh/known_hosts"
```

`--remote-repo-path` and `--control-plane-token-env` are omitted on purpose —
the tool now defaults to `/srv/viberoots` and `VBR_DEPLOY_CONTROL_PLANE_TOKEN`
respectively ([build-tools/tools/deployments/nixos-shared-host-install-prompt.ts:48](build-tools/tools/deployments/nixos-shared-host-install-prompt.ts)).

### B3. Verify the regenerated manifest

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install client list
jq . .local/deployments/nixos-shared-host/clients/mini.json
```

The new file should show:

- `remoteRepoPath`: `/srv/viberoots`
- `controlPlaneTokenEnv`: `VBR_DEPLOY_CONTROL_PLANE_TOKEN`
- `localManagedPaths`: a path under `/Users/kiltyj/Code/viberoots/...`
- a fresh `toolFingerprint` matching the current tool build

And `client list` must not report `invalidProfiles`.

---

## Part C — End-to-end verification

From the workstation:

```bash
export VBR_DEPLOY_CONTROL_PLANE_TOKEN='...'   # value unchanged from BNX_* days

direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --plan
```

Then a real deploy:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini
```

Success signals:

- the plan render succeeds and shows `/srv/viberoots` paths
- the deploy run reaches a non-error terminal state
- on `mini`, `journalctl -u <service>` shows the request handled by the
  freshly-restarted control-plane service with no env-var lookup warnings
- `server status` on `mini` continues to report `managed: true`,
  `wiringState: wired`

### C1. Infisical-backed deployment readiness

Before switching a protected/shared deployment to `secret_backend = "infisical"`,
confirm the migrated control-plane path can carry Infisical worker metadata
without moving secret material into the profile or records. For the
containerized runtime, Infisical Universal Auth credentials are files mounted
through the control-plane credential directory; do not set host-local
`VBR_MINI_INFISICAL_CLIENT_ID` or `VBR_MINI_INFISICAL_CLIENT_SECRET`
environment variables for the service or workers.

1. keep `infisical_runtime` in `TARGETS` limited to non-secret routing data and
   reviewed environment variable names
2. provision deployment-scoped credential files on `mini`, for example
   `/run/secrets/pleomino-staging-infisical-client-id` and
   `/run/secrets/pleomino-staging-infisical-client-secret`
3. wire those files through
   `services.viberoots.deploymentControlPlaneContainer.credentials`
4. restart the containerized control-plane units after changing credential
   sources
5. run a plan or admit-only check for the Infisical-backed target through the
   regenerated profile:

   ```bash
   direnv exec . build-tools/tools/bin/deploy \
     --deployment //projects/deployments/pleomino-dev:deploy \
     --profile mini \
     --admit-only
   ```

6. verify the execution snapshot contains `infisicalRuntime` with the reviewed
   env variable names, but does not contain the Universal Auth client secret,
   an Infisical access token, or `INFISICAL_TOKEN`

This post-check proves the upgraded control-plane metadata points at
`viberoots/viberoots`, the service identity is the current `viberoots` service
path, and the worker secret-context wiring can activate Infisical from mounted
credential files after the pre-`viberoots` migration.

---

## Part D — Move `mini` to the containerized control plane

Use this section for the current `mini` migration target. The authoritative
runtime contract is
[docs/control-plane-nixos-container-module.md](docs/control-plane-nixos-container-module.md)
and the broader design is
[docs/control-plane-containerization.md](docs/control-plane-containerization.md).

### D1. Validate the containerized service before touching `mini`

Before the first real `mini` setup, run the full containerized control-plane
E2E path locally or in CI with Podman or an equivalent OCI runtime:

```bash
direnv exec . build-tools/tools/bin/v //:deployments_control_plane_container_e2e
```

The test must start the reviewed image through the OCI runtime, run the control
plane service, run two workers against shared Postgres and S3-compatible
fixtures, and exercise the web UI, MCP endpoint, audit records, redaction,
idempotency, and artifact digest failure paths. Do not use a direct `pgmem://`
single-process smoke as the final migration gate because it cannot prove
multi-container coordination.

### D2. Build and review the image reference

Build the deployment control-plane image from the reviewed checkout and record
the immutable digest that will run on `mini`:

```bash
cd /srv/viberoots
nix build .#deployment-control-plane-image
```

Publish or load that image into the registry/runtime used by `mini`, then pin
the host config to either:

- `image = "registry.example.com/viberoots/deployment-control-plane@sha256:REVIEWED";`
- or `imageRegistry`, `imageRepository`, and `imageDigest`

Do not configure `mini` from a mutable image tag alone.

### D3. Provision external state and credential files

The containerized service and workers are stateless beyond mounted scratch
paths. Provision these before enabling the module:

- a shared control-plane Postgres URL in a file such as
  `/run/secrets/deploy-control-plane-database-url`
- a bearer token file such as `/run/secrets/deploy-control-plane-token`
- a reviewed-source SSH key file such as
  `/run/secrets/deploy-reviewed-source-ssh-key`
- reviewed source known-hosts at
  `/etc/deployment-control-plane/github-known-hosts`
- S3-compatible artifact store endpoint, access key id, secret access key, and
  bucket
- deployment-scoped Infisical credential files, for example
  `/run/secrets/pleomino-staging-infisical-client-id` and
  `/run/secrets/pleomino-staging-infisical-client-secret`

Secret values must live in host-local secret files managed by SOPS-nix, agenix,
manual provisioning, or another reviewed secret system. Do not put secret
values in Nix options, checked-in config, service environment files, or client
profiles.

### D4. Enable the NixOS container module

Add the repo-owned module to the `mini` NixOS config:

```nix
{
  imports = [
    /srv/viberoots/build-tools/tools/nix/deployment-control-plane-container-module.nix
  ];

  services.viberoots.deploymentControlPlaneContainer = {
    enable = true;
    instanceId = "mini";
    image = "registry.example.com/viberoots/deployment-control-plane@sha256:REVIEWED";
    publicUrl = "https://deploy.apps.kilty.io";
    publicHostName = "deploy.apps.kilty.io";
    manageNginx = true;

    containerRuntime = "podman";
    workerReplicas = 2;
    webUi.enable = true;
    mcp.enable = true;

    artifactStore = {
      kind = "s3-compatible";
      bucket = "deployment-control-plane-artifacts";
    };

    credentials = {
      control-plane-database-url.source = "/run/secrets/deploy-control-plane-database-url";
      control-plane-token.source = "/run/secrets/deploy-control-plane-token";
      reviewed-source-ssh-key.source = "/run/secrets/deploy-reviewed-source-ssh-key";
      artifact-store-endpoint.source = "/run/secrets/deploy-artifact-store-endpoint";
      artifact-store-access-key-id.source =
        "/run/secrets/deploy-artifact-store-access-key-id";
      artifact-store-secret-access-key.source =
        "/run/secrets/deploy-artifact-store-secret-access-key";
      pleomino-staging-infisical-client-id.source =
        "/run/secrets/pleomino-staging-infisical-client-id";
      pleomino-staging-infisical-client-secret.source =
        "/run/secrets/pleomino-staging-infisical-client-secret";
    };
  };
}
```

The module defaults to binding the service on `127.0.0.1:7780`, enabling the web
UI at `/`, enabling MCP at `/mcp`, and creating state roots under
`/var/lib/deployment-control-plane`. Keep the old
`/var/lib/deployment-host` tree available for rollback until the cutover is
accepted, but do not mount it into the new containers as runtime state.

### D5. Switch the host and verify the running containers

Apply the config:

```bash
cd /srv/viberoots
nixos-rebuild switch --flake /etc/nixos
```

Verify the runtime surface:

```bash
systemctl status podman-deployment-control-plane-service
systemctl status podman-deployment-control-plane-worker-1
systemctl status podman-deployment-control-plane-worker-2
curl -fsS http://127.0.0.1:7780/healthz
```

Then verify through the public route:

```bash
curl -fsS https://deploy.apps.kilty.io/healthz
```

Open `https://deploy.apps.kilty.io/` and confirm the web UI loads through the
same origin as the API. Confirm the MCP endpoint is present at
`https://deploy.apps.kilty.io/mcp` if MCP is expected for this host.

### D6. Run a real deploy smoke

From the workstation, regenerate the local profile if needed, then run:

```bash
export VBR_DEPLOY_CONTROL_PLANE_TOKEN='...'

direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --plan

direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini
```

Success requires all of the following:

- the plan and deploy use `https://deploy.apps.kilty.io`
- the service and both worker containers remain healthy
- worker heartbeats and run records appear in the shared database
- artifact uploads land in the configured S3-compatible store
- audit records do not contain secret values
- the web UI shows the run without client-side access to control-plane
  credentials

## Rollback

If A5 or A6 fails:

1. Restore the old checkout: `mv /srv/common.pre-rename.bak /srv/common`.
2. Revert `/etc/nixos` changes (`git` checkout if `/etc/nixos` is versioned;
   otherwise restore from `nixos-rebuild list-generations` + `switch`).
3. Re-export the `BNX_*` env vars and restart the service.
4. Re-run `client install --profile mini --remote-repo-path /srv/common
--control-plane-token-env BNX_DEPLOY_CONTROL_PLANE_TOKEN` locally to put
   the stale profile back.

The host's `/var/lib/deployment-host/{runtime,records}`, retained artifact
storage, control-plane database, current-stage-state records, and
`platform-state.json` are untouched by either direction of this migration, so
rollback does not lose deployment history.
