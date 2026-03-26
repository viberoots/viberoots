# Mini Setup

This document explains how to set up `mini` and your dev Mac so the current
`nixos-shared-host` deployment slice is usable in practice.

This is intentionally scoped to what the repo implements today:

- provider family: `nixos-shared-host`
- component kind: `static-webapp`
- protection class: `shared_nonprod`
- canonical example deployment: `//projects/deployments/pleomino-dev:deploy`

It does **not** describe the future shared control plane. Today’s flow is an
operator-driven path using the reviewed local tooling already in the repo.

## What Exists Today

The repo already gives you:

- deployment metadata in `TARGETS`
- extraction and validation
- authoritative `nixos-shared-host` platform-state reconciliation
- host rendering through the NixOS module
- static artifact publishing
- blocking smoke checks
- durable local deploy records
- explicit removal

What is still manual today:

- wiring the rendered platform state into the real `mini` host
- making wildcard DNS and wildcard TLS for `*.apps.kilty.io` point at `mini`
- bridging the current publisher into the live `mini` runtime

That last point matters:

- the publisher writes to the reviewed local runtime mirror under `hostRoot`
- the NixOS module realizes real containers from `statePath`
- the repo does not yet ship a reviewed built-in remote/live publish bridge for
  the actual running NixOS containers

So the real setup has two parts:

1. make `mini` consume the authoritative platform state and expose the routes
2. choose an operator bridge for publish until the later control-plane work lands

## One-Time Dev Mac Setup

From your Mac:

1. Install `direnv` and `nix-direnv`.
2. Clone this repo.
3. Run:

```bash
direnv allow
```

4. Confirm the toolchain is available:

```bash
direnv exec . nix --version
direnv exec . buck2 --version
direnv exec . node --version
direnv exec . pnpm --version
direnv exec . build-tools/tools/bin/shell-cache-check
direnv exec . node build-tools/tools/dev/startup-check.ts
```

5. Make sure you can SSH to `mini`.
6. Make sure your local git branch can be checked out on `mini` too.

Recommended Mac conveniences:

- an SSH alias for `mini`
- `rsync` available
- the repo checked out at the same path or an easy-to-find path on both machines

## One-Time Mini Setup

`mini` should be a NixOS machine with:

- Nix enabled
- this repo checked out locally
- `direnv` enabled for the repo checkout
- inbound `80` and `443` open
- wildcard DNS for `*.apps.kilty.io` pointing at `mini`
- wildcard TLS for `*.apps.kilty.io` available on the host nginx

### 1. Choose Stable Paths On `mini`

Use stable host paths. A practical starting point is:

```text
/var/lib/bucknix/nixos-shared-host/platform-state.json
/var/lib/bucknix/nixos-shared-host/records/
/var/lib/bucknix/nixos-shared-host/runtime/
```

Create them:

```bash
sudo mkdir -p /var/lib/bucknix/nixos-shared-host/records
sudo mkdir -p /var/lib/bucknix/nixos-shared-host/runtime
sudo sh -c 'printf "%s\n" "{\"version\":1,\"provider\":\"nixos-shared-host\",\"host\":\"nixos-shared-host\",\"deployments\":[]}" > /var/lib/bucknix/nixos-shared-host/platform-state.json'
```

### 2. Import The Host Module

Add the repo module to `mini`’s NixOS configuration:

```nix
{
  imports = [
    /path/to/bucknix-fresh/build-tools/tools/nix/nixos-shared-host-module.nix
  ];

  nixosSharedHost.enable = true;
  nixosSharedHost.statePath = /var/lib/bucknix/nixos-shared-host/platform-state.json;

  system.stateVersion = "24.11";
}
```

Then apply it:

```bash
sudo nixos-rebuild switch
```

### 3. Make Wildcard DNS And TLS Real

The deployment contract assumes this already exists:

- `*.apps.kilty.io` resolves to `mini`
- nginx on `mini` can terminate TLS for those names

The module in this repo does **not** provision DNS or certificates for you.
You must provide them in `mini`’s base host config.

At minimum, verify:

```bash
dig pleomino.apps.kilty.io +short
curl -I https://pleomino.apps.kilty.io
```

The second command can fail before the first deploy, but DNS and TLS should at
least be pointed at `mini`.

## The Important Current Bridge

Today’s repo code renders real container and nginx state for `mini`, but the
publisher writes to the reviewed host-side runtime mirror under `hostRoot`.

That means you need one operator bridge for real publishing today.

### Recommended Temporary Bridge

Use a host path on `mini` as the publish source of truth and bind it into the
container runtime.

Conceptually:

- repo publisher writes to:

```text
/var/lib/bucknix/nixos-shared-host/runtime/containers/<app>/srv/static-app/...
```

- the live `mini` container serving that app should see the same
  `/srv/static-app/...` contents via a host bind mount

This bridge is not fully automated by the repo yet, so implement it in
`mini`’s local NixOS config around the generated container shape.

If you do **not** add this bridge, the repo’s deploy command still gives you a
real validated local runtime mirror, but it will not update the live container
filesystem by itself.

## Validate The Repo Slice Before First Use

From your Mac or from `mini`:

```bash
direnv exec . node build-tools/tools/deployments/validate.ts
direnv exec . buck2 cquery //projects/deployments/...
```

For the example deployment:

```bash
direnv exec . buck2 build //projects/deployments/pleomino-dev:deploy
```

## First Bring-Up On `mini`

The simplest current flow is to run the deploy tooling on `mini` itself so the
artifact build, platform-state update, runtime mirror, records, and smoke all
happen against the same machine.

From the repo checkout on `mini`:

```bash
direnv allow
direnv exec . i
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --host-root /var/lib/bucknix/nixos-shared-host/runtime \
  --state /var/lib/bucknix/nixos-shared-host/platform-state.json \
  --records-root /var/lib/bucknix/nixos-shared-host/records
```

What this does:

- resolves the deployment metadata
- builds the component artifact if `--artifact-dir` is not supplied
- updates authoritative platform state
- renders host config
- materializes the reviewed runtime mirror
- publishes the static artifact
- runs blocking smoke against `https://${appName}.apps.kilty.io`
- writes a durable local deploy record

After that, apply or re-apply the host config on `mini` if needed:

```bash
sudo nixos-rebuild switch
```

If your `mini` configuration already consumes the live `statePath`, the host
topology should follow the updated platform-state automatically on rebuild.

## Mac-Driven Workflow

If you want to operate from your Mac, use SSH to run the real mutating step on
`mini`.

Recommended pattern:

1. Develop and review on your Mac.
2. Push or sync the repo checkout to `mini`.
3. SSH into `mini`.
4. Run the deploy command there.

That keeps the current mutation path honest, because today’s tooling is still
host-local rather than a remote control-plane submission.

## Using A Prebuilt Artifact

If you want to build on your Mac and publish that exact artifact on `mini`:

1. Build the app on your Mac.
2. Copy the `dist/` directory to `mini`.
3. Run:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --artifact-dir /path/to/copied/dist \
  --host-root /var/lib/bucknix/nixos-shared-host/runtime \
  --state /var/lib/bucknix/nixos-shared-host/platform-state.json \
  --records-root /var/lib/bucknix/nixos-shared-host/records
```

This is the cleanest way to keep the artifact exact while the runtime bridge is
still operator-managed.

## Explicit Removal

To remove a deployment from `mini` explicitly:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --host-root /var/lib/bucknix/nixos-shared-host/runtime \
  --state /var/lib/bucknix/nixos-shared-host/platform-state.json \
  --records-root /var/lib/bucknix/nixos-shared-host/records \
  --remove
```

Then re-apply host config if needed:

```bash
sudo nixos-rebuild switch
```

This removes the deployment from authoritative platform state and records an
explicit-removal run.

## What To Check After Each Deploy

Check the public site:

```bash
curl -I https://pleomino.apps.kilty.io/
curl -I https://pleomino.apps.kilty.io/healthz
```

Check the durable records:

```bash
ls -1 /var/lib/bucknix/nixos-shared-host/records/runs
tail -n +1 /var/lib/bucknix/nixos-shared-host/records/runs/*.json
```

Check the authoritative platform state:

```bash
cat /var/lib/bucknix/nixos-shared-host/platform-state.json
```

## Recommended Reality-Based Workflow Today

Until the later shared-control-plane work lands, this is the safest real setup:

1. Keep your normal development flow on your Mac.
2. Keep a checked-out repo on `mini`.
3. Let `mini` consume `platform-state.json` through
   `build-tools/tools/nix/nixos-shared-host-module.nix`.
4. Provide wildcard DNS and TLS outside the repo.
5. Add a mini-local bind-mount bridge so the publisher’s host-side runtime
   mirror is what the live container serves.
6. Run real mutating deploy and remove commands on `mini`.

That gives you a real, working `mini` setup with the current PR-1 through PR-4
implementation, while staying honest about what is still manual.

## What Changes Later

When PR-5 and later deployment work lands, expect this manual to get shorter.
The future direction is:

- shared control-plane admission
- locking
- reviewed remote mutation authority
- a proper built-in live publish bridge
- authoritative shared deployment records

At that point, the Mac should submit work and `mini` should just realize it.
