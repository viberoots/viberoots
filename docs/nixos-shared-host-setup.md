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

- a server install manifest
- a managed module file
- a managed anchor file
- optionally the shared-host platform state and runtime/records directories

The installer does not try to regex-edit arbitrary host config files.

## What "Managed" Means

In this guide, "managed" does not mean "the whole host belongs to the repo."
It means only this:

- the installer created a specific file or directory for the shared-host setup
- that file or directory is recorded in the install manifest
- status and uninstall are allowed to act on that recorded path later

That includes:

- the install manifest
- the managed module file
- the managed anchor file
- the dedicated managed block inserted into the chosen config entry file when
  `managed-dropin` is used
- the shared-host state, runtime, and records paths that the manifest claims

Plain-language ownership:

- "installer-managed" means "this setup tool created it and may update or
  remove it later"
- "operator-managed" means "a human or some other system owns it, so this
  installer must not guess about it"

The most important operator-managed path is usually the authoritative NixOS
config entry file such as `/etc/nixos/configuration.nix`. That file often
contains hand-edited host configuration unrelated to this deployment system.

`managed` matters because status and uninstall only trust manifest-owned
assets. If something is outside that set, the installer treats it as
operator-managed and leaves it alone.

## Terminology

- `managed` is the umbrella concept: a path is tracked and owned by the
  installer
- `managed-manual-wire` is the default install mode
- `managed-dropin` is the auto-wiring install mode
- `emit-only` is the non-mutating install mode

So "managed" and "`managed-dropin`" are not synonyms. A host can have
installer-managed assets because it was installed in `managed-manual-wire` or
`managed-dropin` mode, but "`managed`" itself is the broader lifecycle
concept.

## Install Modes

### `managed-manual-wire`

Use this when you want the installer to create and track the dedicated
shared-host assets, but you do not want it to edit the authoritative NixOS
config entry file.

This mode writes:

- the managed manifest
- the managed module file
- the managed anchor file
- `platform-state.json`
- runtime and records directories

This mode does not edit `--config-entry-path`.

Instead, it emits the exact config instruction you should add manually.

Tradeoffs:

- this is the safest fully managed default when the authoritative NixOS config
  file is still treated as operator-managed
- status and uninstall work for the dedicated shared-host assets because those
  assets are still installer-managed
- status can inspect whether the operator later wired the anchor when
  `--config-entry-path` is known
- uninstall removes installer-managed assets but does not try to remove a
  manual config import from the authoritative config file

### `emit-only`

Use this when you want the exact managed NixOS module snippet, managed anchor
snippet, managed paths,
and config-entry instruction without mutating the host tree.

This mode does not write the managed manifest, managed module files, runtime
directories, or `platform-state.json`.

Tradeoffs:

- safest choice when you want full manual review before changing host config
- works well when another team or another process owns the authoritative host
  config file
- the installer does not create any managed assets at all in this mode
- `server status` and `server uninstall` have no managed install to inspect or
  remove, because nothing was written
- best thought of as "generate the exact config snippet and instructions, then
  stop"

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

Tradeoffs:

- fastest path to a fully managed shared host because install, status, and
  uninstall all operate on the same manifest-owned assets
- gives the installer a reviewed, explicit place to own the shared-host wiring
- easiest mode to inspect and cleanly uninstall later
- requires an authoritative config entry file that the installer can safely
  update with its dedicated managed block
- not appropriate when you do not want the repo to own that wiring step

So the practical split is now:

- `emit-only`
  - write nothing
- `managed-manual-wire`
  - manage dedicated shared-host assets, but leave the authoritative config
    file for manual review
- `managed-dropin`
  - manage dedicated shared-host assets and also write the reviewed managed
    block into the authoritative config file

The authoritative Nix config entry file is still the main place where
user-edited content is expected and conflicts are most likely.

The other managed paths are intended to belong entirely to this build and
deployment system. The installer still fails closed if those paths already
contain conflicting unmanaged content, but they are designed to be dedicated
installer-managed setup paths rather than mixed-use operator files.

## Server Install

Run on the NixOS server itself:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  server install \
  --server-root / \
  --config-root /etc/nixos \
  --config-entry-path /etc/nixos/configuration.nix \
  --install-mode managed-manual-wire
```

When you run `server install` in an interactive terminal, the installer asks for
missing setup values. Required fields get defaults only when the default is
part of the reviewed contract:

- `configRoot`
  - defaults to `/etc/nixos`
- `installMode`
  - defaults to `managed-manual-wire`
- `configEntryPath`
  - becomes required when `installMode=managed-manual-wire` or
    `installMode=managed-dropin`
  - defaults to `<configRoot>/configuration.nix`

Optional server fields do not get defaults, so you can leave them blank to keep
them out of the final install input.

Structured stdin JSON is also supported for `server install`:

```bash
printf '%s\n' '{
  "configRoot": "/etc/nixos",
  "configEntryPath": "/etc/nixos/configuration.nix",
  "installMode": "managed-manual-wire",
  "statePath": "/var/lib/bucknix/nixos-shared-host/platform-state.json",
  "runtimeRoot": "/var/lib/bucknix/nixos-shared-host/runtime",
  "recordsRoot": "/var/lib/bucknix/nixos-shared-host/records"
}' | direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  server install
```

For `server install`, explicit flags still take precedence over stdin JSON.

Useful optional flags:

- `--server-root /fixture/root`
  - for tests and isolated dry-run fixture trees
- `--config-topology plain|flake`
  - only needed when reviewed detection is not enough
- `--managed-root /etc/nixos/bucknix/nixos-shared-host`
- `--state-path /var/lib/bucknix/nixos-shared-host/platform-state.json`
- `--runtime-root /var/lib/bucknix/nixos-shared-host/runtime`
- `--records-root /var/lib/bucknix/nixos-shared-host/records`
- `--dry-run`

For `managed-manual-wire` and `managed-dropin`, `--config-entry-path` is
required.

`server status` and `server uninstall` remain flag-driven; structured stdin JSON
is currently supported for `server install` and `client install`.

Server preflight checks fail closed on:

- non-NixOS hosts
- missing required Nix experimental features
- unwritable managed paths
- conflicting unmanaged managed-dropin paths
- unsupported or unrecognized managed manifest schema versions

## Status / Inspect

Inspect whether a server is managed:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  server status \
  --server-root / \
  --config-root /etc/nixos
```

The status output reports:

- whether the server is managed
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
  server uninstall \
  --server-root / \
  --config-root /etc/nixos
```

Uninstall guarantees:

- only manifest-owned paths are removed
- unrelated sibling files are preserved
- already-missing managed paths are tolerated
- reviewed legacy manifest versions are migrated or rejected explicitly

## Client Install

The client installer records a local profile for targeting a real
`nixos-shared-host`.

When you run `client install` in an interactive terminal, the installer asks
for missing setup values. All client manifest fields are required,
and only those required fields get defaults:

- `profileName`
  - defaults to `default`
- `destination`
  - defaults to the current `profileName`
- `remoteRepoPath`
  - defaults to `/srv/common`
- `remoteStatePath`
  - defaults to `/var/lib/bucknix/nixos-shared-host/platform-state.json`
- `remoteRuntimeRoot`
  - defaults to `/var/lib/bucknix/nixos-shared-host/runtime`
- `remoteRecordsRoot`
  - defaults to `/var/lib/bucknix/nixos-shared-host/records`
- `sshMode`
  - defaults to `ssh`

Flag-based input:

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

Stdin-based input:

```bash
printf '%s\n' '{
  "profileName": "mini",
  "destination": "mini",
  "remoteRepoPath": "/srv/common",
  "remoteStatePath": "/var/lib/bucknix/nixos-shared-host/platform-state.json",
  "remoteRuntimeRoot": "/var/lib/bucknix/nixos-shared-host/runtime",
  "remoteRecordsRoot": "/var/lib/bucknix/nixos-shared-host/records",
  "sshMode": "ssh"
}' | direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  client install
```

The generated profile lives under:

- `.local/deployments/nixos-shared-host/clients/`

Override with `--output-root` when needed.

Current limitation:

- the client installer records connection and path metadata only
- `build-tools/tools/bin/deploy` now consumes `--profile` for non-mutating
  `--plan` / `--dry-run` only
- it does not yet perform SSH transport, remote artifact copy, or remote
  `nixos-rebuild switch` on your behalf

Client lifecycle commands:

- list installed client profiles:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install client list
```

- remove one client profile explicitly:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  client uninstall \
  --profile mini
```

- remove all client profiles explicitly:

```bash
direnv exec . build-tools/tools/bin/nixos-shared-host-install \
  client uninstall \
  --all
```

`client uninstall` fails closed unless you provide exactly one selector:

- `--profile <name>` to remove one profile
- `--all` to remove every installed client profile under `--output-root`

## Reviewing A Remote Deploy Plan

Once you have a client profile, you can ask the deploy tool to render the
reviewed remote target contract without mutating the host or attempting any
transport:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --plan
```

`--dry-run` is an alias for `--plan`.

The plan output is deterministic and includes:

- selected deployment id and label
- selected profile and destination
- reviewed remote repo path
- reviewed remote authoritative state path
- reviewed remote runtime root
- reviewed remote records root
- selected artifact source contract
- whether host apply is still expected as a later step

Remote profile precedence rules:

- the installed profile is the base reviewed remote-target contract
- explicit remote flags override the matching profile values:
  - `--destination`
  - `--remote-repo-path`
  - `--remote-state-path`
  - `--remote-runtime-root`
  - `--remote-records-root`
  - `--ssh-mode`
- local mutation flags such as `--host-root`, `--state`, `--records-root`,
  `--remove`, and the smoke-connect flags are rejected when `--profile` is
  selected because that combination is ambiguous

Transport contract in this interim slice:

- the only reviewed transport mode is `ssh`
- unsupported transport values fail closed
- `--profile` mode is still non-mutating in this PR
- this is still an interim direct-mutation operator aid, not the later
  shared-control-plane submission model

## Managed Manifest Contract

Current server manifest schema:

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

## Wiring The Server Config

The installer creates a dedicated managed anchor file under the managed root.

Example managed root:

- `/etc/nixos/bucknix/nixos-shared-host`

For `managed-manual-wire`, the installer leaves `--config-entry-path` alone and
returns the exact instruction you should add manually.

For `managed-dropin`, the installer wires that anchor into the explicit
`--config-entry-path` by inserting a dedicated managed block. If the file does
not match a reviewed `imports = [ ... ]` or `modules = [ ... ]` topology, the
installer fails closed instead of guessing.

For `emit-only`, the command returns the same exact instruction, but it does
not create any managed assets on disk.

## Deploying After Install

Once the server is installed and its authoritative config imports the managed
anchor, the normal deploy flow remains:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --host-root /var/lib/bucknix/nixos-shared-host/runtime \
  --state /var/lib/bucknix/nixos-shared-host/platform-state.json \
  --records-root /var/lib/bucknix/nixos-shared-host/records
```

Then apply server config as usual:

```bash
sudo nixos-rebuild switch
```

## Deploying Pleomino To `mini` From Jenkins

Current workable pattern:

- Jenkins must run the deploy on `mini` itself, or SSH into `mini` and run the
  deploy there
- the current deploy tool mutates local paths and does not have built-in remote
  transport
- `mini` must already be installed as a managed `nixos-shared-host`
- `mini` must already have a repo checkout that Jenkins can update or use

Why this shape is required today:

- `build-tools/tools/bin/deploy` expects local filesystem paths such as
  `--host-root`, `--state`, and `--records-root`
- if Jenkins builds artifacts elsewhere, it must still copy them to `mini` and
  then invoke deploy on `mini` with a path that exists on `mini`
- there is not yet a Jenkins-native wrapper, shared-control-plane submission
  path, or built-in remote executor beyond non-mutating
  `deploy --profile mini --plan`

If Jenkins can SSH to `mini`, the simplest current pattern is:

```bash
ssh mini '
  set -euo pipefail
  cd /srv/common
  direnv exec . build-tools/tools/bin/deploy \
    --deployment //projects/deployments/pleomino-dev:deploy \
    --host-root /var/lib/bucknix/nixos-shared-host/runtime \
    --state /var/lib/bucknix/nixos-shared-host/platform-state.json \
    --records-root /var/lib/bucknix/nixos-shared-host/records
  sudo nixos-rebuild switch
'
```

If Jenkins wants to build the artifact before the deploy step, the current
manual variant is:

1. Build the Pleomino artifact in Jenkins.
2. Copy the artifact directory to `mini`.
3. Run deploy on `mini` with `--artifact-dir <path-on-mini>`.
4. Run `sudo nixos-rebuild switch` on `mini`.

Example shape:

```bash
rsync -az ./dist/ mini:/tmp/pleomino-dist/
ssh mini '
  set -euo pipefail
  cd /srv/common
  direnv exec . build-tools/tools/bin/deploy \
    --deployment //projects/deployments/pleomino-dev:deploy \
    --artifact-dir /tmp/pleomino-dist \
    --host-root /var/lib/bucknix/nixos-shared-host/runtime \
    --state /var/lib/bucknix/nixos-shared-host/platform-state.json \
    --records-root /var/lib/bucknix/nixos-shared-host/records
  sudo nixos-rebuild switch
'
```

Not yet implemented, but required for a finished Jenkins flow:

- a reviewed Jenkins pipeline or wrapper that owns the SSH/transport step
- a built-in remote deploy path instead of "run deploy on `mini`"
- first-class consumption of client/profile metadata from CI
- shared-control-plane submission, locking, and admission for shared deploys
- immutable artifact replay/promotion support beyond the current direct deploy
  path

## Deploying Pleomino From Your Dev Machine Via A Finished Remote Flow

The fully finished remote flow is not implemented yet.

Today, the client installer records reviewed connection metadata for a real
`nixos-shared-host`, and the deploy tool consumes that metadata for
non-mutating `--plan` / `--dry-run` output. Actual remote execution is still
manual, so "remote deploy from my dev machine" still means "SSH to `mini` and
run the deploy on `mini`."

Reviewed preflight plan:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --plan
```

Current workable operator flow:

1. Install the server side on `mini`.
2. Optionally record a local client profile with `client install`.
3. Optionally render `deploy --profile mini --plan` to confirm the reviewed
   remote repo/state/runtime/records contract before transport.
4. SSH to `mini`.
5. Run `build-tools/tools/bin/deploy` from the repo checkout on `mini`.
6. Run `sudo nixos-rebuild switch` on `mini`.

Example:

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

ssh mini '
  set -euo pipefail
  cd /srv/common
  direnv exec . build-tools/tools/bin/deploy \
    --deployment //projects/deployments/pleomino-dev:deploy \
    --host-root /var/lib/bucknix/nixos-shared-host/runtime \
    --state /var/lib/bucknix/nixos-shared-host/platform-state.json \
    --records-root /var/lib/bucknix/nixos-shared-host/records
  sudo nixos-rebuild switch
'
```

If you want to build locally and deploy that exact artifact, you still need a
manual copy step today:

1. Build Pleomino locally.
2. Copy the built artifact to `mini`.
3. SSH to `mini` and run deploy with `--artifact-dir <path-on-mini>`.
4. Run `sudo nixos-rebuild switch` on `mini`.

Not yet implemented, but required for a finished dev-machine remote flow:

- transport execution behind `build-tools/tools/bin/deploy --profile mini`
  instead of plan-only output
- built-in SSH execution or another reviewed transport layer
- remote artifact staging that uses the installed client profile automatically
- remote `nixos-rebuild switch` orchestration or a reviewed apply wrapper
- a shared-control-plane path instead of direct host mutation from the operator
  path

## Upgrade Guidance

When the installer sees a reviewed legacy manifest version, it migrates it to
the current manifest schema.

When it sees an unknown manifest version, it refuses to mutate the host. That
is intentional: manual upgrade guidance is safer than guessed destructive edits.
