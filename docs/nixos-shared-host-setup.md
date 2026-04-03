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

- the client installer records the reviewed remote target contract only
- `build-tools/tools/bin/deploy --profile <name>` now performs reviewed SSH
  transport and remote artifact staging for the current direct deploy flow
- remote host apply now stays explicit:
  - pass `--apply-host` to run a reviewed remote host apply after deploy
  - pass `--apply-host-dry-run` to run reviewed preflight plus
    `nixos-rebuild dry-activate`
  - ambient defaults still skip host apply entirely

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
- selected host-apply mode
- reviewed remote config root and managed root for host apply
- whether an actual host apply is still expected as a later step

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
  and `--remove` are rejected when `--profile` is selected because that
  combination is ambiguous
- smoke-connect flags remain available in `--profile` mode for reviewed remote
  smoke overrides

Transport contract in this interim slice:

- the only reviewed transport mode is `ssh`
- unsupported transport values fail closed
- `--profile` mode stages a local artifact onto the reviewed remote host and
  then runs the existing deploy wrapper from the remote repo checkout
- host apply is a second explicit reviewed step:
  - `--apply-host` runs remote preflight and then `nixos-rebuild switch`
  - `--apply-host-dry-run` runs the same preflight and then
    `nixos-rebuild dry-activate`
  - no ambient default performs host apply implicitly
- host-apply preflight fails closed when:
  - the server is unmanaged
  - managed wiring is missing or not inspectable
  - the reviewed remote state/runtime/records paths are missing
- staged artifacts land under:
  - `<remoteRuntimeRoot>/.deploy-artifacts/<deployment>/<run-id>`
- staged artifacts are removed by default after the remote deploy returns
- pass `--retain-remote-artifact` to keep the staged remote artifact for
  debugging
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

- Jenkins can now run the reviewed remote wrapper from another machine
- Jenkins can opt into reviewed remote host apply with `--apply-host` or
  preview it with `--apply-host-dry-run`
- `mini` must already be installed as a managed `nixos-shared-host`
- `mini` must already have a repo checkout that Jenkins can update or use
- the host apply remains explicit and opt-in; Jenkins should choose that mode
  deliberately rather than rely on ambient defaults

Why this shape is required today:

- `build-tools/tools/bin/deploy --profile <name>` now owns the reviewed SSH
  transport and exact-artifact staging path
- there is not yet a Jenkins-native pipeline wrapper, shared-control-plane
  submission path, or shared-control-plane admission around host apply

Example shape:

```bash
direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --artifact-dir ./dist
```

Not yet implemented, but required for a finished Jenkins flow:

- a reviewed Jenkins pipeline or wrapper that owns the SSH/transport step
- first-class consumption of client/profile metadata from CI
- shared-control-plane submission, locking, and admission for shared deploys
- immutable artifact replay/promotion support beyond the current direct deploy
  path

## Deploying Pleomino From Your Dev Machine Via The Reviewed Remote Flow

The reviewed remote flow now stages a local artifact to the target host over
SSH and then runs the existing deploy wrapper from the remote repo checkout.
This keeps the mutation model narrow: the remote layer transports the artifact
and invokes the same deploy implementation the host would run locally.

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
   remote repo/state/runtime/records/staging contract before execution.
4. Run the reviewed remote deploy wrapper from your machine.
5. If you want the host config applied too, add `--apply-host`.
6. If you want to validate host apply first without switching, use
   `--apply-host-dry-run`.

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

direnv exec . build-tools/tools/bin/deploy \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --profile mini \
  --artifact-dir ./dist \
  --apply-host
```

If you want to keep the staged remote artifact for inspection, add:

```bash
--retain-remote-artifact
```

The remote summary reports:

- the reviewed remote repo/state/runtime/records roots
- the exact staged remote artifact path
- whether the stage was removed or retained
- the remote deploy result JSON, including the remote record path
- the selected host-apply mode and, when requested, the reviewed host-apply
  result JSON

This flow still does not do:

- shared-control-plane submission or locking
- remote repo checkout management

Not yet implemented, but required for a finished dev-machine remote flow:

- a shared-control-plane path instead of direct host mutation from the operator
  path

## Upgrade Guidance

When the installer sees a reviewed legacy manifest version, it migrates it to
the current manifest schema.

When it sees an unknown manifest version, it refuses to mutate the host. That
is intentional: manual upgrade guidance is safer than guessed destructive edits.
