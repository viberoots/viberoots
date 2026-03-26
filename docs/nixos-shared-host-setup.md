# NixOS Shared Host Setup

This guide covers the reviewed install tooling for the current
`nixos-shared-host` deployment slice.

Current implemented scope:

- provider family: `nixos-shared-host`
- component kind: `static-webapp`
- protection class: `shared_nonprod`
- canonical example deployment: `//projects/deployments/pleomino-dev:deploy`

The install workflow is now centered on:

- `build-tools/tools/bin/nixos-shared-host-install`
- a versioned managed-install manifest
- dedicated repo-managed drop-in files
- explicit dry-run, status, and uninstall commands

`mini` remains a good example host, but it is no longer special in the
contract.

## What The Installer Manages

The installer writes only repo-managed assets:

- a host install manifest
- a managed module file
- a managed anchor file
- optionally the shared-host platform state and runtime/records directories

The installer does not try to regex-edit arbitrary host config files.

## Install Modes

### `emit-only`

Use this when you want the exact managed NixOS module snippet, managed anchor
snippet, managed paths,
and config-entry instruction without mutating the host tree.

This mode does not write the managed manifest, managed module files, runtime
directories, or `platform-state.json`.

### `managed-dropin`

Use this when the target host config root is explicit and you want the reviewed
repo-managed files plus initialized runtime state under the chosen state and
runtime roots.

This mode writes:

- the managed manifest
- the managed module file
- the managed anchor file
- the reviewed managed block into the explicit `--config-entry-path`
- `platform-state.json`
- runtime and records directories

## Host Install

Run on the NixOS host itself:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  host install \
  --config-root /etc/nixos \
  --config-entry-path /etc/nixos/configuration.nix \
  --install-mode managed-dropin
```

Useful optional flags:

- `--host-root /fixture/root`
  - for tests and isolated dry-run fixture trees
- `--config-topology plain|flake`
  - only needed when reviewed detection is not enough
- `--managed-root /etc/nixos/bucknix/nixos-shared-host`
- `--state-path /var/lib/bucknix/nixos-shared-host/platform-state.json`
- `--runtime-root /var/lib/bucknix/nixos-shared-host/runtime`
- `--records-root /var/lib/bucknix/nixos-shared-host/records`
- `--dry-run`

For `managed-dropin`, `--config-entry-path` is required.

Host preflight checks fail closed on:

- non-NixOS hosts
- missing required Nix experimental features
- unwritable managed paths
- conflicting unmanaged managed-dropin paths
- unsupported or unrecognized managed manifest schema versions

## Status / Inspect

Inspect whether a host is managed:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  host status \
  --config-root /etc/nixos
```

The status output reports:

- whether the host is managed
- the manifest schema version and tool fingerprint
- the managed paths that still exist
- wiring state:
  - `wired`
  - `missing`
  - `unknown`

`unknown` means the installer has no explicit config-entry file to inspect.

## Uninstall

Uninstall reads the versioned manifest and removes only manifest-owned assets:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  host uninstall \
  --config-root /etc/nixos
```

Uninstall guarantees:

- only manifest-owned paths are removed
- unrelated sibling files are preserved
- already-missing managed paths are tolerated
- reviewed legacy manifest versions are migrated or rejected explicitly

## Dev-Machine Install

The dev-machine installer records a local profile for targeting a real
`nixos-shared-host`.

Flag-based input:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  dev-machine install \
  --profile mini \
  --destination mini \
  --remote-repo-path /srv/bucknix-fresh \
  --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json \
  --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime \
  --remote-records-root /var/lib/bucknix/nixos-shared-host/records \
  --ssh-mode ssh
```

Stdin-based input:

```bash
printf '%s\n' '{
  "profileName": "mini",
  "destination": "mini",
  "remoteRepoPath": "/srv/bucknix-fresh",
  "remoteStatePath": "/var/lib/bucknix/nixos-shared-host/platform-state.json",
  "remoteRuntimeRoot": "/var/lib/bucknix/nixos-shared-host/runtime",
  "remoteRecordsRoot": "/var/lib/bucknix/nixos-shared-host/records",
  "sshMode": "ssh"
}' | direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  dev-machine install
```

The generated profile lives under:

- `.local/deployments/nixos-shared-host/dev-machines/`

Override with `--output-root` when needed.

## Managed Manifest Contract

Current host manifest schema:

- `nixos-shared-host-install@1`

The manifest records:

- tool schema version
- tool fingerprint
- install mode
- config topology
- config root
- optional config-entry path
- managed root
- state path
- runtime root
- records root
- managed files and directories
- managed entrypoints

Reviewed legacy compatibility:

- `nixos-shared-host-install@0` migrates to the current schema
- unknown versions fail closed with explicit guidance

## Wiring The Host Config

The installer creates a dedicated managed anchor file under the managed root.

Example managed root:

- `/etc/nixos/bucknix/nixos-shared-host`

For `managed-dropin`, the installer wires that anchor into the explicit
`--config-entry-path` by inserting a dedicated managed block. If the file does
not match a reviewed `imports = [ ... ]` or `modules = [ ... ]` topology, the
installer fails closed instead of guessing.

For `emit-only`, the command returns the exact instruction you should add to the
authoritative config entry, but it does not modify the file.

## Deploying After Install

Once the host is installed and its authoritative config imports the managed
anchor, the normal deploy flow remains:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --host-root /var/lib/bucknix/nixos-shared-host/runtime \
  --state /var/lib/bucknix/nixos-shared-host/platform-state.json \
  --records-root /var/lib/bucknix/nixos-shared-host/records
```

Then apply host config as usual:

```bash
sudo nixos-rebuild switch
```

## Upgrade Guidance

When the installer sees a reviewed legacy manifest version, it migrates it to
the current manifest schema.

When it sees an unknown manifest version, it refuses to mutate the host. That
is intentional: manual upgrade guidance is safer than guessed destructive edits.
