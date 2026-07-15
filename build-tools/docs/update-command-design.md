# Update Command Design

This document defines the intended command model for local repo maintenance after dependency,
lockfile, or viberoots tooling changes. The design separates read-only materialization from
intentional mutation so fresh clones, post-clone bootstrap, local installs, dependency refreshes,
and viberoots updates do not chase one another.

## Problem

The current workflow has blurred several jobs:

- materializing local ignored state from committed metadata;
- repairing deterministic metadata after source or lockfile edits;
- refreshing dependency lockfiles from manifests;
- intentionally upgrading dependency versions;
- updating the checked-in viberoots pin or submodule pointer.

When one command is allowed to do all of these, normal setup can accidentally mutate tracked files,
post-clone can fail after partially changing state, and consumer repos can drift between
`flake.lock`, submodule pointers, and pnpm hash metadata.

## Goals

- Keep `i` safe for fresh clones, branch switches, post-clone, and CI by making it read-only for
  tracked files.
- Give developers one simple command, `u`, for the common case after normal repo edits such as
  changing `package.json`.
- Keep broad dependency upgrades explicit with `u --upgrade`.
- Keep viberoots tooling updates explicit with `viberoots update`.
- Make stale-state errors teach the next command without asking users to classify internal metadata.
- Avoid fallbacks that hide missing metadata, stale locks, or viberoots pin drift.

## Non-Goals

- Do not make `i` repair tracked metadata.
- Do not make `u` update the viberoots pin, submodule, or flake input.
- Do not make `u --upgrade` update viberoots itself.
- Do not require users to remember language-specific commands for ordinary dependency maintenance.
- Do not silently broaden a conservative lock refresh into a package upgrade.

## Command Model

```text
i
  Materialize local ignored state from committed source, locks, and metadata.
  Must not change tracked files.

u
  Update repo dependency/materialization state after normal developer edits.
  May refresh dependency lockfiles from manifests conservatively.
  May refresh deterministic derived metadata such as pnpm hash metadata and exact-store metadata.
  Must not broadly upgrade dependency versions.
  Must not update viberoots.

u --upgrade
  Intentionally upgrade project dependency versions using ecosystem-appropriate update commands.
  Runs the same reconciliation as `u` afterward.
  Must not update viberoots.

viberoots update
  Intentionally update viberoots tooling for the consumer repo.
  In submodule mode, updates the submodule pointer and parent metadata coherently.
  In flake mode, updates the flake pin coherently.
  Must not perform project dependency upgrades.
```

`u deps` is not the preferred public model. It asks users to distinguish lock repair from metadata
repair, which is a tooling detail. The common developer intent is simpler: "I edited dependency
inputs; make the repo consistent." That should be plain `u`.

## Everyday Scenarios

### Fresh Clone or Pull

Run:

```bash
i
```

`i` materializes local state from committed metadata. If committed metadata is stale, `i` fails
before mutating tracked files and prints the repair command.

### Manual `package.json` Edit

After adding, removing, or changing a dependency in `package.json`, run:

```bash
u
i && b && v
```

`u` refreshes the lockfile conservatively from the manifest and then refreshes derived metadata.
It should preserve existing locked versions where the ecosystem supports that.

### Existing Lockfile Change

After a merge, scaffold, or manual package-manager command changes a lockfile, run:

```bash
u
```

If the lockfile is already the intended source of truth, `u` only refreshes derived metadata and
local materialization metadata.

### Dependency Upgrade Maintenance

When the intent is to move package versions, run:

```bash
u --upgrade
i && b && v
```

This is the path for security updates, monthly dependency sweeps, or intentionally moving
transitive dependencies within allowed ranges.

### viberoots Tooling Update

When the intent is to update viberoots itself, run:

```bash
viberoots update
i && b && v
```

`viberoots update` may need to run the shared reconciliation engine after moving the viberoots pin,
because a new viberoots version can change deterministic metadata. Its authority is still limited
to viberoots updates plus required reconciliation; it must not upgrade project dependencies.

## Mutation Authority

| Command            | Tracked file mutation                     | Dependency lock mutation                                   | Dependency version upgrades | viberoots pin mutation |
| ------------------ | ----------------------------------------- | ---------------------------------------------------------- | --------------------------- | ---------------------- |
| `i`                | No                                        | No                                                         | No                          | No                     |
| `u`                | Yes, for lock repair and derived metadata | Conservative repair only                                   | No broad upgrades           | No                     |
| `u --upgrade`      | Yes                                       | Yes                                                        | Yes                         | No                     |
| `viberoots update` | Yes                                       | Only if required by viberoots reconciliation, not upgrades | No                          | Yes                    |

For pnpm, conservative repair means the equivalent of refreshing lockfiles from current manifests,
not running a broad `pnpm update`. If an ecosystem cannot provide a conservative repair mode, `u`
should fail with a clear command-specific explanation rather than silently upgrading packages.

## Supported Language Behavior

This model applies to every supported non-Rust language surface. Rust dependency management is
explicitly out of scope for this design.

### Node And TypeScript

- `i` reads `package.json`, `pnpm-lock.yaml`, checked-in pnpm hash metadata, exact-store metadata,
  and generated provider metadata. It may link or materialize ignored local `node_modules` state,
  but it must not change tracked files.
- `u` handles ordinary Node/TypeScript edits. It conservatively refreshes `pnpm-lock.yaml` from
  `package.json` when needed, then refreshes pnpm hash metadata, exact-store metadata, and generated
  provider/glue metadata.
- `u --upgrade` intentionally runs package upgrade behavior for selected importers and then runs
  the same reconciliation as `u`.
- `viberoots update` may refresh deterministic Node/TypeScript metadata only when required by a new
  viberoots pin. It must not run broad project dependency upgrades.

### Go

- `i` reads `go.mod`, `go.sum`, `gomod2nix.toml`, and Go provider/glue metadata. It must fail if
  those tracked files are stale instead of running `go mod tidy` or regenerating `gomod2nix.toml`.
- `u` handles ordinary Go dependency edits. It may run the conservative repair path equivalent to
  `go mod tidy` when needed and then regenerate deterministic `gomod2nix.toml` and provider/glue
  metadata.
- `u --upgrade` runs the explicit bounded Go policy: canonical Nix-store `go get -u ./...`, then
  `go mod tidy` and transactional `gomod2nix.toml` reconciliation. The operation has a bounded
  timeout and restores `go.mod`, `go.sum`, and `gomod2nix.toml` byte-for-byte on failure.
- `viberoots update` must not upgrade Go dependencies.

### Python

- `i` reads Python project manifests, `uv.lock`, and Python provider/glue metadata. It must fail if
  the lock or tracked generated metadata is stale instead of refreshing it.
- `u` handles ordinary Python dependency edits. It may run the conservative uv lock repair path
  where supported, preserving existing locked choices when possible, then refresh deterministic
  provider/glue metadata.
- `u --upgrade` runs canonical Nix-store `uv lock --upgrade` with a bounded timeout and restores
  `uv.lock`, including its prior presence or absence, on failure.
- `viberoots update` must not upgrade Python dependencies.

### C++

- `i` reads C++ BUILD inputs, Nix provider/source-selection metadata, C++ patch metadata, and
  generated provider/glue metadata. It may materialize ignored local state, but it must not rewrite
  tracked provider, source-selection, patch, or glue files.
- `u` handles deterministic C++ metadata repair required by current checked-in C++ inputs, such as
  provider/source-selection or generated glue refreshes. C++ does not get a package-manager
  lockfile repair path unless a future design adds one.
- `u --upgrade` reports C++ as reconciliation-only because C++ has no upgradeable dependency
  authority. It must not opportunistically move nixpkgs packages or provider selections.
- `viberoots update` must not upgrade C++ dependencies or source selections.

## Error Message Contract

Read-only commands should classify stale state by the user's next action:

```text
tracked dependency/materialization metadata is stale
no tracked files were modified
repair: run `u`
```

```text
viberoots pins are inconsistent
no tracked files were modified
repair: run `viberoots update`
```

Messages should name the stale files and the expected deterministic change when possible, but the
headline should be the exact repair command. A consistency guard cannot infer that a developer
intends to move dependency versions, so it must not emit `u --upgrade` as repair guidance. That mode
is selected explicitly by the developer. A language without upgradeable dependency authority is
reported as reconciliation-only and must not move source-selection or package-version authority.

## Implementation Requirements

- `i` and post-clone must run in read-only metadata mode and fail closed if committed metadata is
  stale.
- `u` should be the default intentional mutation path for dependency and materialization
  consistency. It should dispatch to language-specific lock repair helpers and then shared metadata
  reconciliation.
- `u --upgrade` should dispatch to language-specific upgrade helpers and then shared reconciliation.
- `viberoots update` should move only viberoots source pins and then run reconciliation required by
  the new viberoots version.
- The reconciliation engine should be shared so `u`, `u --upgrade`, and `viberoots update` do not
  each grow separate hash/glue/exact-store logic.
- Consumer-repo commit checks should reject incoherent states before commit:
  - source mode and check-in mode disagree;
  - submodule pointer and `flake.lock` disagree in submodule mode;
  - tracked dependency metadata is stale;
  - post-clone would dirty tracked files.

## Validation Requirements

Focused coverage should prove:

- `i` and post-clone do not mutate tracked files.
- `i` fails clearly when dependency/materialization metadata is stale.
- `u` repairs normal manifest or lockfile edits without updating viberoots.
- `u --upgrade` can move dependency versions and then reconciles metadata without updating
  viberoots.
- `viberoots update` updates viberoots pins coherently in both submodule and flake modes.
- A fresh recursive clone plus post-clone leaves `git diff --exit-code` and `git status --short`
  clean when committed metadata is current.

## Documentation Requirements

User-facing docs should teach the simple daily path:

```bash
i && b && v
```

After normal dependency edits:

```bash
u
i && b && v
```

For dependency upgrades:

```bash
u --upgrade
i && b && v
```

For viberoots tooling updates:

```bash
viberoots update
i && b && v
```

Avoid teaching `u && i && b && v` as the default happy path for every checkout. `u` is an
intentional mutation command, while `i` is the read-only setup/materialization command.
