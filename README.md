# viberoots

viberoots is a Buck2 + Nix monorepo containing build infrastructure, deployment tooling,
scaffolding, templates, repo-local automation, and shared libraries. Use it to develop repo
projects, generate new project surfaces, manage reviewed deployment contexts, and run consistent
local or CI verification.

## Quick Start

Install only the external tools needed to enter the repository and let Nix provide the rest
automatically:

1. Install Git so you can clone and update the repository.
2. Install Nix with the [Determinate Nix Installer](https://determinate.systems/nix-installer/).
   Determinate Nix provides the Nix command and flakes support used by this repo.
3. Install `direnv` and `nix-direnv`. Choose one setup path.

   `nix-darwin` is a macOS system-configuration layer for Nix. Use it if you already manage, or want
   to manage, workstation tools declaratively; otherwise use the vanilla macOS helper path.

   **With nix-darwin**

   If you manage workstation tools with `nix-darwin`, add:

   ```nix
   {
     nix.enable = false;
     programs.direnv.enable = true;
   }
   ```

   `nix.enable = false` lets Determinate Nix manage Nix configuration while `nix-darwin`
   manages the rest of the system. `programs.direnv.enable` installs `direnv`, wires shell
   integration, and enables `nix-direnv` by default.

   **Without nix-darwin**

   On vanilla macOS, use the repo bootstrap helper in the clone step below. Do not install
   `direnv`/`nix-direnv` manually unless the helper reports a problem.

   The helper installs missing `direnv`/`nix-direnv` packages with `nix profile install`, wires
   `~/.config/direnv/direnvrc`, and adds the zsh hook to `~/.zshrc`.

Then clone the repo and run the normal local verification path:

```bash
git clone <repo-url> viberoots
cd viberoots
```

If you did not use `nix-darwin`, run the bootstrap helper now:

```bash
./build-tools/tools/bootstrap/macos-direnv.sh
source ~/.zshrc
```

The first command installs and wires `direnv`/`nix-direnv`. The second command reloads your zsh
configuration so `direnv` is available in the current terminal.

Then allow the repo shell and run tests:

```bash
direnv allow
i && b && v
```

Nothing else needs to be installed for normal repo work; Nix supplies the rest automatically.
No repo-specific `/etc/nix/nix.custom.conf` entries are required for normal local development. Keep
private substituters, access tokens, and remote builders out of public setup instructions; configure
them only when you own that infrastructure.

## Topic Entrypoints

- **Repository Map**: [`docs/README.md`](docs/README.md) is the main documentation index for
  current repo docs, ADRs, operator references, and documentation placement rules.
- **Build System**: [`build-tools/docs/README.md`](build-tools/docs/README.md) covers Buck2/Nix architecture,
  language rules, remote execution, linking, scaffolding, and generated glue.
- **Language Work**: [`build-tools/docs/lang/README.md`](build-tools/docs/lang/README.md) covers language design
  requirements. [`docs/handbook/new-language-walkthrough.md`](docs/handbook/new-language-walkthrough.md)
  covers the add-a-language workflow.
- **Contributor Workflow**: [`docs/handbook/README.md`](docs/handbook/README.md) and [`TESTING.md`](TESTING.md) cover
  verification, CI, patching, local setup, and PR workflow.
- **Apps And Libraries**: [`projects/apps/`](projects/apps/) and [`projects/libs/`](projects/libs/) contain package-local
  code and docs. Use the local development commands below for normal builds, tests, and dev
  servers.
- **Deployments**: [`docs/deployments-usage.md`](docs/deployments-usage.md) covers the deployment CLI.
  [`docs/control-plane-guide.md`](docs/control-plane-guide.md) covers protected/shared
  control-plane setup.
- **Secrets And Configuration**: [`docs/sprinkleref.md`](docs/sprinkleref.md), [`docs/secrets-usage.md`](docs/secrets-usage.md),
  and [`docs/deployment-secrets-api.md`](docs/deployment-secrets-api.md) cover secret references,
  backend usage, and the secret API.
- **Remote Builds And Distributed Tests**: [`build-tools/docs/remote-build-setup.md`](build-tools/docs/remote-build-setup.md) covers setup
  and operation.
- **Product And Project Planning**: [`projects/docs/`](projects/docs/) contains product-specific planning artifacts.
- **Documentation History**: [`docs/history/README.md`](docs/history/README.md) contains archived plans, migrations, completed
  task tracks, investigations, and old design notes.
- **Repo-Local Automation**: [`plugins/repo-skills/`](plugins/repo-skills/) contains Codex skills and PR/test workflow helpers.
- **Architecture Decisions**: [`docs/adrs/README.md`](docs/adrs/README.md) contains accepted ADRs.

## Repo Layout

- `build-tools/`: Buck2/Nix build system, language macros, toolchain helpers, and tests.
- `build-tools/deployments/`: reusable deployment package implementations and infrastructure
  foundations.
- `build-tools/docs/`: build-system reference docs, active designs, and remote-build setup.
- `config/`: repo-level control-plane configuration templates and supporting config roots.
- `docs/`: repo-wide deployment, control-plane, secrets, ADR, handbook, and documentation-placement
  guidance.
- `docs/history/`: archived plans, migrations, historical tasks, investigations, and old design
  notes.
- `plugins/`: repo-local Codex skills and plugin metadata.
- Root workspace files: `flake.nix`, `package.json`, `pnpm-workspace.yaml`, `TARGETS`, and CI files
  define the repository-wide development shell, package workspace, Buck package root, and automation
  entrypoints.
- `projects/apps/` and `projects/libs/`: application and library roots, including package-local
  docs. Current app roots include data-room services and Pleomino.
- `projects/docs/`: product-specific planning artifacts.
- `projects/deployments/`: deployment-family metadata and package-local deployment docs.
- `projects/config/shared.json`: checked-in deployment contexts, control-plane profiles, and
  non-secret shared project configuration.
- `projects/config/local.json`: gitignored local overrides and operator-local config values.
- `patches/`: repo-level patch overlays where a language contract supports global patches.
- `third_party/`: external provider metadata and generated provider glue.
- `toolchains/`: Buck and Nix toolchain wiring.
- `types/`: shared TypeScript declarations.

## Local Development Commands

After `direnv allow`, the repo shell provides short wrappers for normal local work:

```bash
i        # install/link dependencies and refresh generated glue
b        # build the default repo scope
v        # run impacted tests and verification checks
```

Shell entry also prepares ignored viberoots workspace state. In this pre-extraction dogfood
checkout, the root flake consumes `path:./viberoots` while `.viberoots/current` points at the live
repository root so Buck cells and Nix-backed commands see local build-tool edits immediately. After
the physical extraction, activation points `.viberoots/current` at the local `viberoots/` source.
Generated provider and Buck graph state stays under `.viberoots/workspace/`.

Check the active source mode and split-readiness diagnostics with:

```bash
viberoots status
```

During the flake split, the status output may list PR-9 blockers such as root `build-tools/`,
`third_party/providers/`, `prelude/`, or `toolchains/`. Those diagnostics mean the checkout is still
in the temporary pre-extraction shape; PR-9 owns moving or removing those root compatibility
surfaces.

The usual local check is:

```bash
i && b && v
```

Run dev servers and other dev runnables with `d`:

```bash
d //projects/apps/pleomino:app
```

`d` uses the target's declared `run.dev` command and reports a clear error when the target is not a
dev runnable. For targeted work, pass Buck labels through the wrappers:

```bash
b //projects/apps/pleomino:app
v //projects/apps/pleomino:latency-guardrail
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

`v` selects an impacted subset from the merge-base diff plus the dirty worktree. Use the forced
full-suite path when you need pre-merge evidence for the entire repo:

```bash
i && b && ALL_TESTS=1 v
```

Coverage is opt-in (`v --coverage` or `ALL_TESTS=1 v --coverage`). Use `s`, `l --status`, or
`build-tools/tools/bin/tail-log --status` to inspect active pass-group and total suite progress. The
local wrappers and Buck Nix actions use `VBR_NIX_CACHE_POLICY=auto` by default, so temporarily
unreachable configured HTTP(S) Nix caches are removed from the current process instead of failing
unrelated builds. Use
`VBR_NIX_CACHE_POLICY=strict` only when cache availability is what you are testing.

## Deployment Config

Deployment targets should select reviewed context from `projects/config/shared.json`. That context
chooses provider topology, secret backend routing, and a named `controlPlanes.<name>` profile for
protected/shared deployments. True secrets stay as backend-neutral `secret://...` refs; runtime-host
inputs use `runtime://...`; non-secret project values use `config://...`.

Start with:

- [`docs/deployments-usage.md`](docs/deployments-usage.md)
- [`docs/control-plane-guide.md`](docs/control-plane-guide.md)
- [`docs/sprinkleref.md`](docs/sprinkleref.md)
- [`docs/secrets-usage.md`](docs/secrets-usage.md)

## Language Work

The build system has current language surfaces for Node/TypeScript, Go, C/C++, Python, and Rust.
The deepest scaffold coverage is for TypeScript/Node webapps, services, and libraries, plus Go
libraries and CLIs; the shared Buck/Nix language layer also provides library, binary, test, native
extension, and artifact rules across the other supported languages.

Language support is more than per-language compilation. The repo provides:

- package patching through repo-level and package-local patch overlays
- wasm producer targets for browser/runtime assets, including Go, C/C++, and Python wasm variants
- module surfaces and provider wiring that connect packages across languages without ad hoc path
  coupling
- generated glue, lockfile integration, and Nix package definitions that keep local, CI, and remote
  builds on the same contracts

Start with:

- [`build-tools/docs/lang/README.md`](build-tools/docs/lang/README.md)
- [`build-tools/docs/scaffolding.md`](build-tools/docs/scaffolding.md)
- [`docs/handbook/patching.md`](docs/handbook/patching.md)
- [`docs/handbook/new-language-walkthrough.md`](docs/handbook/new-language-walkthrough.md)
- [`docs/handbook/adding-language.md`](docs/handbook/adding-language.md)

## License

Except for `projects/`, this repository is licensed under the MIT License. The `projects/`
directory is excluded from the license grant and all rights in those files are reserved unless a
separate license file inside `projects/` says otherwise. See [`LICENSE`](LICENSE).
