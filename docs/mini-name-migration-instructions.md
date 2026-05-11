# `mini` Name-Migration Instructions

Aligns the `mini` shared-host deployment (server + local client profile) with
the completed repo rename from `bucknix`/`bnx`/`kiltyj/common` to
`viberoots`/`vbr`/`viberoots/viberoots`.

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

Persistent host state under `/var/lib/deployment-host/{runtime,records}` and
`/etc/nixos/deployment-host/platform-state.json` does **not** embed the repo
path — it stays put across the rename. (See [docs/nixos-shared-host-setup.md:113](docs/nixos-shared-host-setup.md).)

## Preconditions

- Repo rename PRs (PR-1..PR-6 in [docs/repo-rename.md](docs/repo-rename.md)) are merged on `main`.
- GitHub repo `viberoots/viberoots` exists and accepts the existing deploy key
  used by `mini`. Verify locally: `ssh -T git@github.com` from `mini` returns
  successfully, and the key is registered on `viberoots/viberoots`.
- You have root SSH to `mini.home.kilty.io`.
- No deploy run is currently in `pending_approval`. Drain or approve in-flight
  runs first so the service can be stopped cleanly.
- A backup of `/var/lib/deployment-host/records` is available if you want one
  before touching the host (the rename does not modify it, but state is
  cheap to snapshot).

## Migration order

The remote host owns the source of truth at `/srv/viberoots` and the running
service. Migrate the **server first**, then regenerate the **local client
profile** so its `toolFingerprint` and defaults match the freshly-renamed
tool. Doing it in the opposite order leaves a client profile pointing at a
`/srv/viberoots` path that does not yet exist.

---

## Part A — Migrate the `mini` host

All commands run as root on `mini` unless noted.

### A1. Stop the deployment service and worker

Identify whichever launcher you are currently using (systemd unit, tmux
session, or screen) and stop both the control-plane service
(`nixos-shared-host-control-plane-service.ts`) and worker
(`nixos-shared-host-control-plane-worker.ts`). The records dir keeps any
in-flight admitted artifacts; you are stopping the processes, not the data.

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

## Rollback

If A5 or A6 fails:

1. Restore the old checkout: `mv /srv/common.pre-rename.bak /srv/common`.
2. Revert `/etc/nixos` changes (`git` checkout if `/etc/nixos` is versioned;
   otherwise restore from `nixos-rebuild list-generations` + `switch`).
3. Re-export the `BNX_*` env vars and restart the service.
4. Re-run `client install --profile mini --remote-repo-path /srv/common
--control-plane-token-env BNX_DEPLOY_CONTROL_PLANE_TOKEN` locally to put
   the stale profile back.

The host's `/var/lib/deployment-host/{runtime,records}` and
`platform-state.json` are untouched by either direction of this migration,
so rollback does not lose deployment history.
