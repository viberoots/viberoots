# viberoots

viberoots is reusable Buck2 + Nix workspace tooling. It provides the development shell, build macros, tool wrappers, scaffolding, templates, deployment helpers, and verification flow consumed by project repositories.

## Quick Start

Run the bootstrap command below to create or upgrade a workspace. Always fetch bootstrap from `main`; use `VBR_REF` only to choose the viberoots ref the workspace consumes. If Nix is not installed yet, bootstrap uses the official [Determinate Nix Installer](https://determinate.systems/nix-installer/) first. See [Options](#options) before running it if you need a submodule checkout, a non-main ref, a dry run, or validation during setup. In the examples below, `my-project` is the workspace root.

```text
my-project/                         # consumer workspace root
├── projects/                        # application and library code
├── .envrc                           # generated shell entry
├── .buckconfig                      # generated Buck cells/config
└── .viberoots/
    ├── current -> /nix/store/...     # remote flake mode source pointer
    └── workspace/                    # hidden flake, lockfile, generated state

my-project/                         # submodule mode adds one visible source checkout
├── projects/
├── viberoots/                        # Git submodule for upstream contribution work
└── .viberoots/current -> ../viberoots
```

The bootstrap script creates or refreshes `projects/`, writes the shared viberoots files, records crash-safe upgrade intent under `.viberoots/bootstrap/transactions/`, installs missing `direnv`/`nix-direnv` support, installs Git from Nix if needed, runs `direnv allow` by default, runs `i` by default, and prints the next validation command. If your shell hook was already active, the environment should load automatically at the next prompt; otherwise open a new shell in the workspace.

**Preferred for most users: remote flake import**

Use this when the project mostly consumes viberoots rather than contributing upstream. The repo stays small: no top-level `viberoots/` checkout, and `.viberoots/workspace/flake.lock` pins the source.

```bash
mkdir my-project && cd my-project
curl -fsSL https://raw.githubusercontent.com/viberoots/viberoots/main/bootstrap | bash
```

**Preferred for upstream contributors: top-level submodule**

Use this when contributors are likely to patch viberoots and project code together. The parent repo pins viberoots through the submodule gitlink, and local edits inside `viberoots/` are consumed directly by Buck and Nix.

```bash
mkdir my-project && cd my-project
curl -fsSL https://raw.githubusercontent.com/viberoots/viberoots/main/bootstrap | \
  VBR_CONSUMER=submodule bash
```

Run the same command in an existing checkout; it initializes an existing `viberoots` submodule if needed and refreshes the workspace files.

After bootstrap, the installed CLI can rerun the same latest-main bootstrap path:

```bash
viberoots bootstrap
viberoots update
```

Both commands fetch the current bootstrap entrypoint from GitHub `main`, then pass through the same `VBR_*` options listed below. Use `bootstrap` for setup/repair language and `update` when the intent is to move the workspace to the current default ref or a `VBR_REF`.

`vbr` is a short alias for `viberoots`. Both commands resolve the workspace from any nested directory inside the consumer repo.

**Options**

| Option                          | Default           | Description                                                                                                                                                                          |
| ------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VBR_CONSUMER=flake\|submodule` | `flake`           | Selects source mode.                                                                                                                                                                 |
| `VBR_REF=<tag-or-commit>`       | `main`            | Selects the viberoots ref consumed by the workspace. Keep the bootstrap URL on `main` so upgrade migrations stay current.                                                            |
| `VBR_INSTALL_NIX=0\|1`          | `1`               | Installs Nix when it is missing.                                                                                                                                                     |
| `VBR_RUN_INSTALL=0\|1`          | `1`               | Runs `i`.                                                                                                                                                                            |
| `VBR_RUN_VALIDATE=0\|1`         | `0`               | Also runs `b && v`.                                                                                                                                                                  |
| `VBR_DIRENV_ALLOW=0\|1`         | `1`               | Runs `direnv allow`.                                                                                                                                                                 |
| `VBR_DRY_RUN=0\|1`              | `0`               | Previews the plan without writing files.                                                                                                                                             |
| `VBR_SUBMODULE=<git-url>`       | official repo     | Selects a different submodule remote. Non-default values require trust confirmation because that repository can run non-viberoots code during setup, install, build, and validation. |
| `VBR_TRUST_SUBMODULE=0\|1`      | `0`               | Confirms that a non-default submodule remote is trusted.                                                                                                                             |
| `VBR_WORKSPACE_ROOT=<dir>`      | current directory | Bootstraps a directory other than the current one.                                                                                                                                   |

The official submodule URL is `https://github.com/viberoots/viberoots.git`.

**Switch Source Mode**

After bootstrap, use the `viberoots` CLI to switch between normal flake consumption and local
submodule contribution mode:

```bash
viberoots use-submodule
viberoots use-flake
viberoots use-flake --remove-submodule
viberoots remove-submodule --dry-run
viberoots remove-submodule
```

`use-flake` leaves an existing `viberoots/` submodule in place by default so switching back remains
simple. `remove-submodule` only removes an inactive, clean submodule with ordinary `.gitmodules` and
gitlink state; it never commits automatically.

**Maintenance**

Use the local maintenance command to preview and run safe generated-state cleanup:

```bash
viberoots gc --dry-run
viberoots gc
viberoots gc --optimize
```

`gc` is a convenience wrapper for `vbr gc` and accepts the same options.

Default `gc` runs normal Nix store garbage collection and removes stale viberoots-owned generated state. `--dry-run` prints the plan without mutating anything. `--no-nix` limits a run to local generated-state cleanup. `--verbose` lists skipped cleanup candidates that are summarized by default. `--optimize` is opt-in because it can take longer; today it adds Nix store deduplication and may grow to include other safe optimizations later.

After setup, run the next command printed by bootstrap. With the default install path, that is:

```bash
i && b && v
```

## Topic Entrypoints

- **Agent Guidance**: [`AGENTS.md`](AGENTS.md) is the single active guide for agent behavior, methodology, repo boundaries, and key usage docs.
- **Repository Map**: [`docs/README.md`](docs/README.md) is the main documentation index for current repo docs, ADRs, operator references, and documentation placement rules.
- **Build System**: [`build-tools/docs/README.md`](build-tools/docs/README.md) covers Buck2/Nix architecture, language rules, remote execution, linking, scaffolding, and generated glue.
- **Language Work**: [`build-tools/docs/lang/README.md`](build-tools/docs/lang/README.md) covers language design requirements. [`docs/handbook/new-language-walkthrough.md`](docs/handbook/new-language-walkthrough.md) covers the add-a-language workflow.
- **Contributor Workflow**: [`docs/handbook/README.md`](docs/handbook/README.md) and [`TESTING.md`](TESTING.md) cover verification, CI, patching, local setup, and PR workflow.
- **Apps And Libraries**: [`projects/apps/`](projects/apps/) and [`projects/libs/`](projects/libs/) contain package-local code and docs. Use the local development commands below for normal builds, tests, and dev servers.
- **Deployments**: [`docs/deployments-usage.md`](docs/deployments-usage.md) covers the deployment CLI. [`docs/control-plane-guide.md`](docs/control-plane-guide.md) covers protected/shared control-plane setup.
- **Secrets And Configuration**: [`docs/sprinkleref.md`](docs/sprinkleref.md), [`docs/secrets-usage.md`](docs/secrets-usage.md), and [`docs/deployment-secrets-api.md`](docs/deployment-secrets-api.md) cover secret references, backend usage, and the secret API.
- **Remote Builds And Distributed Tests**: [`build-tools/docs/remote-build-setup.md`](build-tools/docs/remote-build-setup.md) covers setup and operation.
- **Product And Project Planning**: [`projects/docs/`](projects/docs/) contains product-specific planning artifacts.
- **Documentation History**: [`docs/history/README.md`](docs/history/README.md) contains archived plans, migrations, completed task tracks, investigations, and old design notes.
- **Repo-Local Automation**: [`plugins/repo-skills/`](plugins/repo-skills/) contains Codex skills and PR/test workflow helpers.
- **Architecture Decisions**: [`docs/adrs/README.md`](docs/adrs/README.md) contains accepted ADRs.

## Repo Layout

- `build-tools/`: Buck2/Nix build system, language macros, toolchain helpers, and tests.
- `build-tools/deployments/`: reusable deployment package implementations and infrastructure foundations.
- `build-tools/docs/`: build-system reference docs, active designs, and remote-build setup.
- `config/`: viberoots control-plane configuration templates and supporting config roots.
- `docs/`: viberoots deployment, control-plane, secrets, ADR, handbook, and documentation-placement guidance.
- `docs/history/`: archived plans, migrations, historical tasks, investigations, and old design notes.
- `plugins/`: repo-local Codex skills and plugin metadata.
- `patches/`: patch overlays where a language contract supports global patches.
- `third_party/`: external provider metadata and generated provider glue.
- `toolchains/`: Buck and Nix toolchain wiring.
- `types/`: shared TypeScript declarations.

Consumer repositories keep application source under their own `projects/` directory. They should not copy viberoots-owned `build-tools/`, `docs/`, `plugins/`, `patches/`, `toolchains/`, or dependency metadata into the parent root.

## Local Development Commands

After setup, the repo shell provides short wrappers for normal local work:

```bash
i        # install/link dependencies and refresh generated glue
b        # build the full default repo scope
v        # run impacted tests and verification checks
```

Shell entry also prepares ignored viberoots workspace state. In a consumer workspace, the hidden `.viberoots/workspace/flake.nix` uses `path:../../viberoots` as the local input while `.envrc` overrides that input to `path:$PWD/viberoots` for local development. Since the flake file itself lives under `.viberoots/workspace`, it resolves the consumer source from `WORKSPACE_ROOT` during Nix evaluation and falls back to `../..` only for local readability. Activation points `.viberoots/current` at the local `viberoots/` source, so Buck cells and Nix-backed commands see local build-tool edits immediately. Generated provider and Buck graph state stays under `.viberoots/workspace/`.

Check the active source mode and split-readiness diagnostics with:

```bash
viberoots status
```

In consumer repositories, status output that reports root `build-tools/`, `third_party/providers/`, `prelude/`, or `toolchains/` means the workspace still contains old combined-repo compatibility surfaces. Remove those from the parent root and keep the source under `viberoots/`.

The usual local check is:

```bash
i && b && v
```

Run dev servers and other dev runnables with `d`:

```bash
d //projects/apps/example-app:app
```

`d` uses the target's declared `run.dev` command and reports a clear error when the target is not a dev runnable. For targeted work, pass Buck labels through the wrappers:

```bash
b //projects/...
b //projects/apps/example-app:app
v //projects/apps/example-app:latency-guardrail
```

Refresh generated glue without running a build:

```bash
i --glue-only
```

For more detail, read:

- [`build-tools/docs/build-system-design.md`](build-tools/docs/build-system-design.md)
- [`docs/handbook/testing.md`](docs/handbook/testing.md)
- [`build-tools/tools/ci/run-stage.ts`](build-tools/tools/ci/run-stage.ts) for the CI stage runner
- [`docs/handbook/patching.md`](docs/handbook/patching.md)
- [`docs/handbook/new-language-walkthrough.md`](docs/handbook/new-language-walkthrough.md)

## Verification

The short local verification path is:

```bash
i && b && v
```

`v` selects an impacted subset from the merge-base diff plus the dirty worktree. Use the forced full-suite path when you need pre-merge evidence for the entire repo:

```bash
i && b && ALL_TESTS=1 v
```

Coverage is opt-in (`v --coverage` or `ALL_TESTS=1 v --coverage`). Use `s`, `l --status`, or `tail-log --status` to inspect active pass-group and total suite progress. The local wrappers and Buck Nix actions use `VBR_NIX_CACHE_POLICY=auto` by default, so temporarily unreachable configured HTTP(S) Nix caches are removed from the current process instead of failing unrelated builds. Use `VBR_NIX_CACHE_POLICY=strict` only when cache availability is what you are testing.

## Deployment Config

Deployment targets should select reviewed context from `projects/config/shared.json`. That context chooses provider topology, secret backend routing, and a named `controlPlanes.<name>` profile for protected/shared deployments. True secrets stay as backend-neutral `secret://...` refs; runtime-host inputs use `runtime://...`; non-secret project values use `config://...`.

Start with:

- [`docs/deployments-usage.md`](docs/deployments-usage.md)
- [`docs/control-plane-guide.md`](docs/control-plane-guide.md)
- [`docs/sprinkleref.md`](docs/sprinkleref.md)
- [`docs/secrets-usage.md`](docs/secrets-usage.md)

## Language Work

The build system has current language surfaces for Node/TypeScript, Go, C/C++, Python, and Rust. The deepest scaffold coverage is for TypeScript/Node webapps, services, and libraries, plus Go libraries and CLIs; the shared Buck/Nix language layer also provides library, binary, test, native extension, and artifact rules across the other supported languages.

Language support is more than per-language compilation. The repo provides:

- package patching through repo-level and package-local patch overlays
- wasm producer targets for browser/runtime assets, including Go, C/C++, and Python wasm variants
- module surfaces and provider wiring that connect packages across languages without ad hoc path coupling
- generated glue, lockfile integration, and Nix package definitions that keep local, CI, and remote builds on the same contracts

Start with:

- [`build-tools/docs/lang/README.md`](build-tools/docs/lang/README.md)
- [`build-tools/docs/scaffolding.md`](build-tools/docs/scaffolding.md)
- [`docs/handbook/patching.md`](docs/handbook/patching.md)
- [`docs/handbook/new-language-walkthrough.md`](docs/handbook/new-language-walkthrough.md)
- [`docs/handbook/adding-language.md`](docs/handbook/adding-language.md)

## License

Except for `projects/`, this repository is licensed under the MIT License. The `projects/` directory is excluded from the license grant and all rights in those files are reserved unless a separate license file inside `projects/` says otherwise. See [`LICENSE`](LICENSE).
