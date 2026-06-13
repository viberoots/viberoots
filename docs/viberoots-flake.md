# Viberoots Flake And Buck Cell Design

## Purpose

This document describes a staged design for separating project code from viberoots tooling while
preserving the current developer experience. The first milestone keeps one checkout workflow, but
makes `viberoots/` a pinned Git submodule that is also a flake and Buck cell. Later milestones allow
independent project repositories to consume that same flake and cell without vendoring the
viberoots source.

The immediate goal is not to remove `projects/` from this repository. The immediate goal is to make
the boundary real:

- `projects/` is workspace-owned product code.
- `viberoots/` is toolchain-owned build, scaffold, validation, deployment, and Buck/Nix glue.
- the top-level repository is a consumer workspace that pins the viberoots source as a submodule.

Once that works, an external `my-project` repository can use the same shape by replacing the local
`./viberoots` dependency with a Git flake input.

The central API decision is that viberoots must treat the consuming workspace root and the
viberoots source root as different locations. `projects/` lives in the consuming workspace, not
inside the viberoots flake or submodule.

## Target Repository Shapes

### Directory Naming

Use `viberoots/` as the top-level reusable tooling directory. Keep `build-tools/` one level deeper
inside it:

```text
repo-root/
  projects/
  viberoots/
    build-tools/
    toolchains/
    prelude/
```

This is more intuitive than making `build-tools/` the top-level dependency boundary. The external
thing a workspace depends on is viberoots, not only its build macros. `build-tools/` remains useful
as an internal source grouping for Buck/Nix build-system implementation code.

In other words:

- `repo-root/viberoots` is the flake and Buck cell boundary;
- `repo-root/viberoots/build-tools` is the existing build-system implementation tree;
- `repo-root/projects` is the product workspace.

Avoid introducing new `third_party` directories in the split layout. Use clearer names:

- `.viberoots/workspace/providers` for workspace-generated provider glue;
- `viberoots/vendor/<name>` for reusable vendored inputs owned by viberoots.

The existing prelude may still contain upstream paths such as `prelude/third-party/fbsource_stub`.
Those are part of the imported prelude layout and are not the workspace dependency boundary.

### Recommended Stage 1: Same Checkout With Viberoots Submodule

The recommended first stage keeps the current top-level project workspace and turns
`repo-root/viberoots` into a Git submodule. The parent repository owns product code and pins a
specific viberoots commit; the viberoots repository owns reusable tooling history and accepts
upstream contributions directly.

```text
repo-root/
  .gitmodules
  flake.nix
  flake.lock
  .buckroot
  .buckconfig
  TARGETS
  pnpm-workspace.yaml
  projects/
    apps/
    libs/
    deployments/
    config/
    docs/
  .viberoots/
    current -> ../viberoots
    workspace/
      providers/
      go/
  viberoots/              # Git submodule
    flake.nix
    flake.lock
    build-tools/
    toolchains/
    prelude/
    vendor/
      uv2nix/
    package.json
    pnpm-lock.yaml
    tsconfig.json
    eslint.config.js
    types/
    docs/
```

The root remains the project workspace. The nested `viberoots/` submodule is both:

- a Nix flake exposing the viberoots development and build-tooling API;
- a Buck cell exposing Starlark macros, prelude, toolchain definitions, and tool implementation
  sources.

The parent repository records the viberoots dependency in two places:

- `.gitmodules` and the submodule gitlink pin the checked-out revision used by Buck cell paths and
  local Nix evaluation;
- `flake.lock` records that the root workspace consumes the local `path:./viberoots` flake input.

During Stage 1 Buck and Nix should both read the same local submodule checkout:

```nix
inputs.viberoots.url = "path:./viberoots";
```

That keeps Buck and Nix looking at the same source tree. A later external consumer can replace the
path input with `github:OWNER/viberoots` while retaining the same workspace API.

The root flake consumes the local viberoots flake:

```nix
{
  description = "project workspace";

  inputs = {
    viberoots.url = "path:./viberoots";
  };

  outputs = inputs:
    inputs.viberoots.lib.mkWorkspace {
      workspaceSrc = ./.;
      viberootsInput = inputs.viberoots;
    };
}
```

The root Buck config consumes the local viberoots cell:

```ini
[buildfile]
name = TARGETS

[cells]
root = .
viberoots = ./.viberoots/current
prelude = ./.viberoots/current/prelude
config = ./.viberoots/current/prelude
toolchains = ./.viberoots/current/toolchains
repo_toolchains = ./.viberoots/current/toolchains
workspace_providers = ./.viberoots/workspace/providers
fbsource = ./.viberoots/current/prelude/third-party/fbsource_stub
fbcode = ./.viberoots/current/prelude/third-party/fbcode_stub

[repositories]
root = .
viberoots = ./.viberoots/current
prelude = ./.viberoots/current/prelude
config = ./.viberoots/current/prelude
toolchains = ./.viberoots/current/toolchains
repo_toolchains = ./.viberoots/current/toolchains
workspace_providers = ./.viberoots/workspace/providers
fbsource = ./.viberoots/current/prelude/third-party/fbsource_stub
fbcode = ./.viberoots/current/prelude/third-party/fbcode_stub

[build]
prelude = prelude
user_platform = prelude//platforms:default
target_platforms = prelude//platforms:default
```

Project targets stay in the root cell:

```text
//projects/apps/pleomino:app
//projects/libs/pleomino-solver-wasm:wasm
//projects/deployments/pleomino/dev:deploy
```

Viberoots-owned rule loads move to the viberoots cell:

```text
@viberoots//build-tools/node:defs.bzl
@viberoots//build-tools/cpp:defs.bzl
@viberoots//build-tools/go:defs.bzl
@viberoots//build-tools/deployments:defs.bzl
```

### Stage 2: External Consumer Repository

After Stage 1, an external project repository can have the same root workspace shape without
vendoring the viberoots source:

```text
my-project/
  flake.nix
  flake.lock
  .buckroot
  .buckconfig
  TARGETS
  pnpm-workspace.yaml
  projects/
    apps/
    libs/
    deployments/
  .viberoots/
    current -> /nix/store/...-source
    workspace/
      providers/
      go/
```

Its flake pins viberoots as an upstream dependency:

```nix
{
  inputs = {
    viberoots.url = "github:OWNER/viberoots/v1.4.2";
  };

  outputs = inputs:
    inputs.viberoots.lib.mkWorkspace {
      workspaceSrc = ./.;
      viberootsInput = inputs.viberoots;
    };
}
```

An external consumer may also choose to keep `viberoots/` as a submodule. That is still compatible
with this design:

```nix
inputs.viberoots.url = "path:./viberoots";
```

Use the submodule form when contributors often patch viberoots and project code together locally.
Use the Git flake input form when the project only needs to consume released or pinned upstream
viberoots revisions. Both forms use the same `mkWorkspace` contract.

Its `.buckconfig` must point Buck cells at the resolved viberoots source. Buck config files cannot
directly evaluate Nix expressions, so the workspace setup must materialize a stable local path, for
example:

```text
my-project/
  .viberoots/current -> /nix/store/...-source
  .viberoots/workspace/providers/
```

Then `.buckconfig` can remain static:

```ini
[cells]
root = .
viberoots = ./.viberoots/current
prelude = ./.viberoots/current/prelude
config = ./.viberoots/current/prelude
toolchains = ./.viberoots/current/toolchains
repo_toolchains = ./.viberoots/current/toolchains
workspace_providers = ./.viberoots/workspace/providers
fbsource = ./.viberoots/current/prelude/third-party/fbsource_stub
fbcode = ./.viberoots/current/prelude/third-party/fbcode_stub
```

If the active Buck version still expects both `[cells]` and `[repositories]`, the workspace should
mirror the same entries in both sections, as the current repository does.

The symlink is generated by the viberoots workspace activation command or by `nix develop` shell
hooks. It is not project source and should be ignored by Git.

## Design Goals

- Running `nix develop` from the workspace root exposes the same commands users run today.
- User-facing command-line tools and interpreters are provided by Nix dev shells, not by Buck cell
  paths.
- Running Buck from the workspace root still uses root-cell labels for product code.
- Project code does not need to vendor viberoots implementation files.
- The default same-checkout dogfood layout uses a Git submodule so viberoots has separate upstream
  history while the parent workspace pins a known-good revision.
- Viberoots-owned Starlark, TypeScript, Nix, prelude, and toolchain code can evolve in one upstream
  repository.
- Project-owned generated provider glue remains in the project workspace because it is derived from
  project lockfiles.
- The same interface supports local dogfooding with `path:./viberoots` and external use with
  `github:OWNER/viberoots`.

## Non-Goals

- Do not redesign project label conventions in this migration. `//projects/apps/*` and
  `//projects/libs/*` remain the canonical project package roots.
- Do not require every project target to become a viberoots-cell target. Product targets remain in
  the root cell.
- Do not move project lockfiles, deployment definitions, app source, or product docs into the
  viberoots flake.
- Do not make Buck depend on Nix evaluation at command time. Buck gets static cell paths; Nix may
  prepare those paths before Buck runs.
- Do not require users to clone the viberoots repository separately for normal external project use.

## Ownership Model

### Git Ownership

The parent workspace repository owns the product workspace and the submodule pointer. The viberoots
repository owns the contents under `viberoots/`.

Parent commits may update:

- product code under `projects/**`;
- workspace-generated glue under `.viberoots/workspace/**`;
- root workspace files such as `.buckconfig`, `flake.nix`, and `pnpm-workspace.yaml`;
- the `viberoots` submodule gitlink when adopting a newer viberoots revision.

Viberoots commits may update:

- `viberoots/build-tools/**`;
- `viberoots/prelude/**`;
- `viberoots/toolchains/**`;
- viberoots flake outputs and reusable tool implementation code.

When a change spans both layers, make two logical commits:

1. a viberoots commit in the submodule repository;
2. a parent workspace commit that updates the submodule pointer and any required project changes.

This loses single-commit atomicity across product and toolchain code, but it preserves separate
ownership while keeping a reproducible parent checkout.

### Workspace-Owned Files

These files belong to the consuming workspace:

- `.gitmodules`
- `projects/**`
- `pnpm-workspace.yaml`
- root `TARGETS`
- root `.buckroot`
- root `.buckconfig`
- root `flake.nix`
- root `flake.lock`
- `.viberoots/workspace/providers/**`
- `.viberoots/workspace/go/**` if generated from project Go modules
- project-level configuration under `projects/config/**`

Generated provider files stay workspace-owned because they depend on lockfiles and project package
discovery. Examples include:

- `.viberoots/workspace/providers/TARGETS.auto`
- `.viberoots/workspace/providers/TARGETS.node.auto`
- `.viberoots/workspace/providers/TARGETS.python.auto`
- `.viberoots/workspace/providers/TARGETS.cpp.auto`
- `.viberoots/workspace/providers/auto_map.bzl`
- `.viberoots/workspace/providers/provider_index.json`

These files should not live inside the `viberoots/` submodule. They are derived from the consuming
workspace's lockfiles and would otherwise dirty the submodule or bake project-specific dependency
state into reusable viberoots source. Keeping them under `.viberoots/workspace/` gives the parent
workspace a clean top-level separation while preserving project ownership.

### Viberoots-Owned Files

These files belong to the viberoots flake and Buck cell:

- `viberoots/build-tools/**`
- `viberoots/toolchains/**`
- `viberoots/prelude/**`
- `viberoots/vendor/uv2nix/**`
- viberoots tool source files and package metadata
- viberoots documentation for build-system internals
- viberoots tests for the reusable toolchain itself

The viberoots cell may contain tests and fixtures, but those tests should not rely on product code
from the root `projects/` directory except through explicit integration-test fixtures.

## Buck Cell Architecture

### Public Load Surface

There are two possible public Starlark surfaces.

Preferred final surface:

```python
load("@viberoots//build-tools/node:defs.bzl", "node_webapp")
load("@viberoots//build-tools/deployments:defs.bzl", "vercel_next_webapp_deployment")
```

Compatibility surface:

```python
load("//build-tools/node:defs.bzl", "node_webapp")
```

The final surface is cleaner because it makes ownership explicit. The compatibility surface reduces
initial churn but requires forwarding shims in the root cell:

```text
repo-root/
  build-tools/
    node/
      defs.bzl
```

with contents like:

```python
load("@viberoots//build-tools/node:defs.bzl", _node_webapp = "node_webapp")

node_webapp = _node_webapp
```

The migration should support compatibility shims initially only if changing all project `TARGETS`
files and tests at once is too risky. New templates should move directly to `@viberoots//...` loads
once the cell is available.

### Internal Viberoots Loads

Viberoots Starlark files currently use root-cell labels such as:

```python
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//third_party/providers:auto_map.bzl", "PROVIDER_MAP")
```

Inside the viberoots cell, self-loads should become explicit cell-local loads:

```python
load("@viberoots//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
```

Project-generated providers are different. They must resolve from the workspace-owned provider
cell:

```python
load("@workspace_providers//:auto_map.bzl", "PROVIDER_MAP")
```

The generated provider location should be a dedicated Buck cell, for example
`workspace_providers = ./.viberoots/workspace/providers`. This avoids a top-level `third_party/`
directory in the parent project and prevents generated project state from entering the viberoots
submodule.

The `workspace_providers` cell root must contain the generated Buck package files that provider
targets need, including `TARGETS` and any `TARGETS.*.auto` files. Provider labels should therefore
look like:

```text
workspace_providers//:nix_pkgs_googletest
workspace_providers//:lf_<hash>_<importer>
```

If Buck load syntax or local conventions require the current `//third_party/...` labels during
migration, the root workspace can temporarily provide forwarding shims. The important final contract
is that generated providers are workspace-owned and exposed through a stable workspace provider
cell, not stored in viberoots-owned source.

### Toolchain Cells

`prelude`, `toolchains`, `repo_toolchains`, `config`, `fbsource`, and `fbcode` remain named cells
because the current prelude and rule definitions expect those names. Their cell paths should go
through the same `.viberoots/current` indirection as the main `viberoots` cell:

```text
prelude = ./.viberoots/current/prelude
toolchains = ./.viberoots/current/toolchains
repo_toolchains = ./.viberoots/current/toolchains
config = ./.viberoots/current/prelude
fbsource = ./.viberoots/current/prelude/third-party/fbsource_stub
fbcode = ./.viberoots/current/prelude/third-party/fbcode_stub
```

For an external consumer, these point at the materialized viberoots source path:

```text
prelude = ./.viberoots/current/prelude
toolchains = ./.viberoots/current/toolchains
repo_toolchains = ./.viberoots/current/toolchains
config = ./.viberoots/current/prelude
fbsource = ./.viberoots/current/prelude/third-party/fbsource_stub
fbcode = ./.viberoots/current/prelude/third-party/fbcode_stub
```

The root workspace should not own copies of these directories.

### Root Cell Contents

The root cell should contain only product and workspace glue:

- root `TARGETS`;
- `projects/**/TARGETS`;
- optional compatibility forwarding shims for generated providers;
- optional compatibility forwarding shims for legacy `//build-tools/...` loads;
- optional workspace-local test fixtures.

Root `TARGETS` should continue exporting workspace files that Buck actions need from the project
root, such as `flake.lock`, if those remain part of the build graph.

## Nix Flake Architecture

### Viberoots Flake Outputs

The viberoots flake should expose at least:

```text
lib.mkWorkspace
devShells.<system>.default
packages.<system>...
apps.<system>...
checks.<system>...
```

`mkWorkspace` is the consumer-facing API. It receives a workspace source and returns the full set of
dev shells, packages, apps, and checks configured for that workspace. The workspace source is the
consumer root containing `projects/`; it is not the viberoots source tree.

The API should make the two roots explicit even if the initial parameter names stay short:

```nix
inputs.viberoots.lib.mkWorkspace {
  workspaceSrc = ./.;
  viberootsInput = inputs.viberoots;
}
```

`workspaceSrc` is the project/workspace root. `viberootsInput` is the flake source providing the
dev shell definitions, templates, prelude, toolchain definitions, and reusable tool source. Do not
use a generic `src` parameter for this API; it is too easy to confuse the workspace source with the
viberoots source.

Conceptual shape:

```nix
{
  outputs = { self, nixpkgs, buck2, gomod2nix, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-linux" "aarch64-linux" ];
    in {
      lib.mkWorkspace = {
        workspaceSrc,
        viberootsInput ? self,
        workspaceName ? "workspace",
      }:
        import ./build-tools/tools/nix/flake/workspace.nix {
          inherit self nixpkgs buck2 gomod2nix workspaceSrc viberootsInput workspaceName;
        };
    };
}
```

The current top-level flake logic should move under viberoots and become parameterized by
`workspaceSrc` or a derived `WORKSPACE_ROOT`, rather than assuming the flake root is also the
product workspace root.

### Root Workspace Flake

The repository root flake becomes thin:

```nix
{
  inputs.viberoots.url = "path:./viberoots";

  outputs = inputs:
    inputs.viberoots.lib.mkWorkspace {
      workspaceSrc = ./.;
      viberootsInput = inputs.viberoots;
      workspaceName = "viberoots-dogfood";
    };
}
```

This dogfoods the external-consumer API while still allowing a single-repo workflow.

### Tool Invocation Contract

From the workspace root:

```sh
nix develop
scaf new ...
v
buck2 build //projects/apps/foo:app
```

All user-facing executables must come from the Nix dev shell. This includes `buck2`, language
toolchains, package managers, `scaf`, `v`, `i`, `b`, `viberoots`, `zx-wrapper`, and any interpreters
used by build actions.

Buck cell paths are not a tool installation mechanism. They locate:

- Starlark rules and macros loaded by `TARGETS` files;
- prelude and toolchain definition files;
- generated provider targets and metadata;
- script source files used as Buck action inputs.

When a Buck rule runs a viberoots script, the script source may come from
`@viberoots//build-tools/...`, but the executable that runs it must come from the Nix-provided
environment. For example, Buck may locate a TypeScript source file in the `viberoots` cell, while
the `node` or `zx-wrapper` used to run it comes from `nix develop`.

The tools must resolve two roots:

- workspace root: the consumer repository root containing `projects/`;
- viberoots root: the flake/cell source containing `build-tools/`, `prelude/`, and `toolchains/`.

Scripts should stop assuming that `process.cwd()` or `WORKSPACE_ROOT` is also the viberoots source
root. They should use explicit environment variables:

```text
WORKSPACE_ROOT=/path/to/my-project
VIBEROOTS_ROOT=/path/to/my-project/.viberoots/current
```

For external consumers, `VIBEROOTS_ROOT` may be the materialized `.viberoots/current` symlink or a
Nix store source path.

Switching from submodule-backed viberoots to remote viberoots should not require changing
`.buckconfig`. The root flake input changes from:

```nix
inputs.viberoots.url = "path:./viberoots";
```

to:

```nix
inputs.viberoots.url = "github:OWNER/viberoots";
```

and workspace activation updates `.viberoots/current` from `../viberoots` to the materialized flake
source path. Buck continues to read the same static cells under `.viberoots/current`.

## Workspace Activation

All consuming workspaces need a way to prepare static Buck cell paths before Buck starts. The
viberoots dev shell should provide a workspace activation step that:

1. resolves the viberoots flake source path;
2. creates or updates `.viberoots/current`;
3. verifies `.buckconfig` points at `.viberoots/current`;
4. verifies `.buckroot` exists;
5. generates or refreshes workspace-owned provider glue when requested by install/update commands;
6. leaves product source files untouched unless the user invoked a scaffold/update command.

The activation step should be idempotent and should not rewrite tracked files during ordinary shell
entry. Tracked bootstrap files should be created by an explicit command such as:

```sh
viberoots init-workspace
```

`nix develop` may refresh ignored symlinks and caches, but it should not surprise users by changing
tracked workspace files.

Recommended ignored paths:

```gitignore
/.viberoots/current
/.viberoots/cache/
```

Do not ignore all of `.viberoots/` if the workspace chooses to commit generated provider files under
`.viberoots/workspace/`.

For the recommended submodule dogfood layout, `.viberoots/current` should point at `../viberoots`.
External consumers that use `github:OWNER/viberoots` instead of a submodule should point
`.viberoots/current` at the materialized Nix store source. In both cases `.buckconfig` can keep the
same cell paths.

In local submodule mode, activation must preserve the live-edit path:

```text
.viberoots/current -> ../viberoots
```

If activation finds that the root flake input is `path:./viberoots` but `.viberoots/current` points
somewhere else, it should repair the symlink or fail with a targeted message. This keeps Buck,
Nix-provided tools, and project workflows reading the same local viberoots checkout.

Generated provider files under `.viberoots/workspace/` may be committed or ignored based on the
workspace's reproducibility policy. The key point is that they are parent-workspace files, not
viberoots submodule files.

## Submodule Workflow

The parent workspace should document normal submodule commands:

```sh
git submodule update --init --recursive
git -C viberoots fetch
git -C viberoots checkout <revision-or-branch>
git add viberoots
```

Recommended policies:

- keep `viberoots/` on a detached, pinned commit for normal project work;
- use a branch inside `viberoots/` only while actively developing viberoots;
- keep the root flake input pointed at `path:./viberoots`, so Nix and Buck consume the same
  submodule checkout;
- CI must initialize submodules before running `nix develop`, Buck, or validation commands;
- parent repository PRs that update the submodule pointer should include validation evidence from
  the project workspace.

The submodule is a distribution and dogfood mechanism, not a substitute for upstream contribution.
Reusable tooling changes should still be committed and reviewed in the viberoots repository.

## Versioning Model

Viberoots versioning has two modes:

- local source mode, used for the recommended submodule dogfood layout and other local-directory
  development;
- remote source mode, used by external projects that consume viberoots from Git.

Both modes should expose the active viberoots version clearly to humans and CI.

### Local Source Mode

Local source mode is selected when the workspace flake uses a path input:

```nix
inputs.viberoots.url = "path:./viberoots";
```

or another explicit local path during development. In this mode, the rule is simple: always use the
checked-out local source. The `viberoots/` submodule gitlink pins the default checkout for the
parent workspace, but local developers may temporarily checkout a branch or detached commit inside
the submodule while working on viberoots.

Consequences:

- Buck reads viberoots through `.viberoots/current`, which points at the local checkout.
- Nix evaluates the same local checkout through `path:./viberoots`.
- Edits made inside the local `viberoots/` checkout must be reflected immediately in project
  workflows after normal Buck/Nix cache invalidation. Local source mode must not copy viberoots into
  a separate generated directory or Nix store source for routine development.
- The parent workspace should not try to interpret semantic versions for local source mode.
- CI for the parent workspace should validate that the root flake input is local path mode when the
  workspace is intended to dogfood a submodule.

Recommended status command output:

```text
viberoots source: local
viberoots path:   /workspace/.viberoots/current
viberoots rev:    <git sha or dirty marker from local checkout>
```

If the local checkout is dirty, tools should report that fact. Dirty local viberoots is acceptable
for development but should fail release or parent CI gates unless explicitly allowed.

### Remote Source Mode

Remote source mode is selected when the workspace flake uses a Git flake reference:

```nix
inputs.viberoots.url = "github:OWNER/viberoots/v1.4.2";
```

or an equivalent explicit Git reference:

```nix
inputs.viberoots = {
  type = "github";
  owner = "OWNER";
  repo = "viberoots";
  ref = "v1.4.2";
};
```

The recommended remote reference is an immutable release tag. The workspace `flake.lock` records the
resolved revision and content hash. For production or shared project work, avoid floating branch
inputs such as `github:OWNER/viberoots/main` unless the project intentionally wants rolling
updates.

Consequences:

- `flake.nix` makes the intended version visible through the input URL or `ref`.
- `flake.lock` pins the exact commit and nar hash.
- Workspace activation points `.viberoots/current` at the resolved flake source path.
- Updates are explicit: change the ref or run an intentional flake update for the `viberoots` input,
  then run validation and commit the `flake.lock` change.

Recommended status command output:

```text
viberoots source: remote
viberoots ref:    v1.4.2
viberoots rev:    <locked git sha>
viberoots path:   /workspace/.viberoots/current -> /nix/store/...-source
```

### Viberoots Version Metadata

The viberoots flake should expose machine-readable version metadata:

```nix
{
  lib.version = "1.4.2";
  lib.releaseTag = "v1.4.2";
}
```

or an equivalent output consumed by tooling. The value should describe the viberoots release series,
not the consuming workspace. Local dirty/dev checkouts may report a derived value such as
`1.4.2-dev+<short-sha>` or `unknown+dirty`.

The dev shell should provide a command such as:

```sh
viberoots version
```

that reports:

- local vs remote source mode;
- declared version from viberoots metadata;
- locked or checked-out Git revision;
- whether the viberoots checkout is dirty;
- the effective `.viberoots/current` path;
- in local source mode, whether `.viberoots/current` points at the live `viberoots/` checkout.

The command also supports `viberoots status` as an alias and `--json` for CI or activation checks.

### Compatibility Policy

Viberoots should treat `lib.mkWorkspace` and the public `@viberoots//build-tools/...` load surface
as versioned APIs. Breaking changes should require a major version bump or a documented migration
guide.

The parent workspace should state the supported viberoots version range only if it needs one. Most
workspaces can rely on their `flake.lock` as the pin and update deliberately.

## Provider Generation Boundary

Provider generation is the trickiest boundary because the rules live in viberoots but generated
provider targets belong to the consumer workspace.

The contract should be:

- viberoots owns the generator implementation;
- the workspace owns the generated provider files;
- viberoots macros load provider maps from the `workspace_providers` cell;
- provider sync runs relative to `WORKSPACE_ROOT`;
- provider generation may read viberoots templates and Nix helpers through `VIBEROOTS_ROOT`.

This avoids baking product lockfiles into the viberoots flake source. It also lets each consumer
commit provider glue derived from its own lockfiles.

## Validated Assumptions

The following assumptions have been validated against the current toolchain or upstream
documentation and should be treated as design constraints:

- Buck named cells can point at static workspace paths. A disposable workspace successfully resolved
  `viberoots = ./.viberoots/current` and
  `workspace_providers = ./.viberoots/workspace/providers` through `buck2 audit cell`.
- Buck `.bzl` loads use the `@cell//package:file.bzl` syntax. Project `TARGETS` should load
  viberoots macros with `load("@viberoots//...", ...)`, and viberoots-owned `.bzl` files can load
  generated provider maps with `load("@workspace_providers//:auto_map.bzl", ...)`.
- Buck target labels, target patterns, and command-line arguments use `cell//package:target`
  without `@`. Use `viberoots//...` and `workspace_providers//...` for targets, not
  `@viberoots//...`.
- A parent flake can delegate to a nested flake with `inputs.viberoots.url = "path:./viberoots"` and
  call `inputs.viberoots.lib.mkWorkspace { workspaceSrc = ./.; ... }`.
- A viberoots flake output can receive `workspaceSrc` outside the viberoots source and still access
  its own source through `viberootsInput.outPath`.
- Remote viberoots consumption is compatible with Buck's static-cell requirement because activation
  can point `.viberoots/current` at the resolved flake source path.

Validated migration blockers:

- Current Starlark has many root-cell `//build-tools/...` loads. Those must become
  `@viberoots//...` loads, or temporary root forwarding shims must exist during migration.
- Current provider code and generated labels assume `//third_party/providers`. Those must move to
  the `workspace_providers` cell or be temporarily shimmed.
- Current scripts often assume the tool source lives under `WORKSPACE_ROOT/build-tools` or
  `$FLK_ROOT/build-tools`. The implementation must introduce and consistently use `VIBEROOTS_ROOT`
  for tool source while keeping `WORKSPACE_ROOT` for product source.
- A symlink to a Nix store source is not by itself a durable garbage-collection root. Activation
  should refresh `.viberoots/current` on shell entry or create an explicit GC root/result link for
  remote-flake mode.
- If the parent workspace itself is consumed as a Git flake while relying on a submodule-backed
  `path:./viberoots` input, the parent source must include submodules. The implementation should
  validate the active Nix version and required flake settings for this workflow before advertising
  remote consumption of the parent workspace.

## Migration Plan

### Phase 0: Inventory And Classification

Classify all top-level paths as workspace-owned or viberoots-owned. The expected result is:

- move to the viberoots repository: `build-tools/`, `toolchains/`, `prelude/`, reusable tool package
  metadata, and reusable Nix helpers;
- keep in the parent workspace: `projects/`, generated `.viberoots/workspace/` provider state, root
  Buck config, root flake, and workspace docs/config;
- decide separately: root `package.json`, root `pnpm-lock.yaml`, root `tsconfig.json`, and
  `eslint.config.js`, because some may belong to viberoots tooling while others may be workspace
  package-management glue.

Exit criteria:

- a checked ownership map exists;
- generated files are identified;
- root-cell compatibility shims are either approved or explicitly rejected.

### Phase 1: Extract Viberoots Repository And Add Submodule

Create the standalone viberoots repository from the viberoots-owned paths, preserving useful history
where practical. Add it back to the parent workspace as a submodule at `viberoots/`.

Exit criteria:

- `.gitmodules` contains `viberoots`;
- `git submodule update --init --recursive` produces `repo-root/viberoots`;
- parent repository no longer tracks viberoots-owned implementation files directly outside the
  submodule;
- CI initializes submodules before build and validation.

### Phase 2: Add Viberoots Flake In Submodule

Create `viberoots/flake.nix` in the submodule. Initially it can import existing Nix code through
temporary paths inside the submodule. The point is to define the output API before fully
parameterizing all scripts.

Exit criteria:

- `nix flake show ./viberoots` works;
- `./viberoots#lib.mkWorkspace` exists conceptually in the flake outputs;
- no project build behavior changes yet.

### Phase 3: Add Viberoots Buck Cell

Expose Buck-owned support paths from the `viberoots/` submodule and update root `.buckconfig` to
define:

```text
viberoots
prelude
toolchains
repo_toolchains
config
fbsource
fbcode
workspace_providers
```

At this phase, compatibility shims may keep existing project loads working.

Exit criteria:

- `buck2 targets viberoots//build-tools/...` works;
- `buck2 targets //projects/...` still works;
- workspace provider targets resolve from `workspace_providers//...`, while `.bzl` loads use
  `@workspace_providers//...`.

### Phase 4: Convert Starlark Loads

Convert viberoots-owned `.bzl` self-loads from root-cell labels to viberoots-cell labels. Convert
project templates and examples to load public macros from `@viberoots//...`.

Exit criteria:

- viberoots-owned code no longer depends on root `//build-tools/...` labels;
- project targets either use `@viberoots//...` directly or rely on intentional root shims;
- new scaffolds generate the chosen public load style.

### Phase 5: Parameterize Tool Scripts By Workspace Root

Update TypeScript and Nix tooling so every filesystem operation is explicit about whether it is
reading the workspace or viberoots source.

Common changes:

- replace implicit `process.cwd()` assumptions with `WORKSPACE_ROOT` where reading project files;
- use `VIBEROOTS_ROOT` for tool templates, Nix helper sources, and reusable script paths;
- keep executable discovery on the Nix-provided `PATH`; do not discover user-facing tools by walking
  Buck cell directories;
- move workspace-generated state currently written under `build-tools/tools/buck/` to a
  workspace-owned location such as `.viberoots/workspace/buck/`;
- keep reusable tool source under `VIBEROOTS_ROOT/build-tools/**`;
- audit tests that copy `build-tools/**` into temp workspaces and convert them to use the viberoots
  cell or a workspace initialization helper.

Exit criteria:

- `nix develop` from root sets both roots;
- `v`, `i`, `b`, scaffolding, provider sync, and deployment tooling operate on the root workspace;
- viberoots tests do not require product code to live inside the viberoots flake directory.

### Phase 6: Thin Root Flake

Replace the root flake implementation with a call to `inputs.viberoots.lib.mkWorkspace`.

Exit criteria:

- root `nix develop` is powered by `./viberoots`;
- root flake no longer imports build logic from root `build-tools`;
- root `flake.lock` records the local `path:./viberoots` input and the submodule gitlink pins the
  actual viberoots revision;
- `viberoots version` or an equivalent status command reports local source mode, checked-out
  revision, dirty state, and `.viberoots/current`;
- current local workflows still work from the repository root.

### Phase 7: External Fixture

Create a minimal external-consumer fixture, either in tests or as a separate template repository.
It should contain no vendored `build-tools`, `prelude`, or `toolchains`.

Exit criteria:

- fixture `nix develop` exposes viberoots commands;
- fixture Buck config points at a materialized viberoots source path;
- fixture uses an explicit remote viberoots version reference and commits the resulting
  `flake.lock`;
- fixture status output reports remote source mode, requested ref, locked revision, and effective
  `.viberoots/current`;
- fixture can build and test a small `//projects/apps/*` target;
- fixture can generate and consume project-owned provider glue.

## Compatibility Strategy

The migration can use forwarding shims to reduce blast radius, but those shims should be treated as
a compatibility layer, not the final architecture.

Acceptable temporary shims:

```text
build-tools/** -> forwards loads to @viberoots//build-tools/**
toolchains/**  -> avoid if possible; prefer named cells
prelude/**     -> avoid; prefer named prelude cell
fbsource/fbcode -> avoid; prefer named cells
```

Avoid forwarding generated provider paths long term. Generated providers are workspace-owned and
should be exposed through the `workspace_providers` cell.

Each shim should have a planned deletion path:

- update templates first;
- update product `TARGETS`;
- update tests;
- remove shim once no load references remain.

## Open Questions

- Should root project `TARGETS` files load viberoots macros directly, or should the root workspace
  keep stable forwarding shims for ergonomics?
- Should `viberoots init-workspace` create missing committed bootstrap files, or only validate them
  after project creation?
- Which root JavaScript/TypeScript package files are viberoots-tooling files versus workspace files?
- Should generated provider files under `.viberoots/workspace/` be committed for reproducibility or
  ignored and regenerated by install/update commands?
- How much of the current viberoots test suite should move under `viberoots/`, and how much should
  become root-level dogfood integration testing?

## Risks

- Buck load paths may be more deeply root-cell-coupled than expected. Mitigation: migrate loads in
  phases and keep temporary forwarding shims.
- Tool scripts may assume `build-tools/` exists under `process.cwd()`. Mitigation: introduce
  `WORKSPACE_ROOT` and `VIBEROOTS_ROOT` early, then audit script entrypoints.
- Provider generation may accidentally write into the viberoots source tree. Mitigation: require all
  generator output paths to be under `WORKSPACE_ROOT`.
- Submodule state may be stale or uninitialized in local checkouts and CI. Mitigation: document
  `git submodule update --init --recursive`, make CI initialize submodules, and make startup checks
  fail with a targeted message when `viberoots/flake.nix` is missing.
- The root flake input may drift away from the checked-out submodule path. Mitigation: add a
  validation check that requires `inputs.viberoots.url = "path:./viberoots"` in the dogfood
  workspace.
- Remote consumers may accidentally use floating viberoots branches. Mitigation: recommend release
  tags for remote mode and make status output show both requested ref and locked revision.
- External consumers may get stale `.viberoots/current` symlinks. Mitigation: activation verifies
  the symlink target against the flake lock and refreshes it idempotently.
- The same-repo dogfood layout can hide external-consumer bugs. Mitigation: add a minimal external
  fixture before declaring the interface stable.

## Success Criteria

The design is complete when all of the following are true:

- from the repository root, `nix develop` provides the normal viberoots tools;
- from the repository root, Buck builds product labels under `//projects/...`;
- root Buck config gets reusable rule code from the `viberoots` cell;
- product targets can load public macros from `@viberoots//...`;
- project-owned provider targets are generated under `.viberoots/workspace/` and consumed through
  the `workspace_providers` cell;
- root flake delegates workspace construction to the `./viberoots` submodule;
- local mode always uses the local viberoots checkout, while remote mode displays an explicit
  requested version and locked revision;
- parent CI initializes and validates the `viberoots` submodule before running build gates;
- a separate project fixture can consume viberoots without vendoring `build-tools`, `prelude`, or
  `toolchains`.
