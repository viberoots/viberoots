# viberoots

viberoots is a Buck2 + Nix monorepo with deployment-control-plane tooling, cloud-control setup
guides, secret-backend runbooks, and language build infrastructure. The repo is organized around
two active user surfaces:

- Deployment operators: use the deployment CLI, control-plane setup, cloud provider evidence, and
  secrets documentation under [`docs/`](docs/README.md).
- Build-system contributors: use Buck2/Nix language macros, provider sync, patching, CI, and
  remote-build documentation under [`build-tools/docs/`](build-tools/docs/README.md) and
  [`docs/handbook/`](docs/handbook/README.md).

## Start Here

- Repository documentation map: [`docs/README.md`](docs/README.md)
- Build-system documentation map: [`build-tools/docs/README.md`](build-tools/docs/README.md)
- Contributor handbook: [`docs/handbook/README.md`](docs/handbook/README.md)
- ADR index: [`docs/adrs/README.md`](docs/adrs/README.md)
- Deployment operator guide: [`docs/deployments-usage.md`](docs/deployments-usage.md)
- Control-plane operator guide: [`docs/control-plane-guide.md`](docs/control-plane-guide.md)
- Remote builds and distributed tests:
  [`build-tools/docs/remote-build-setup.md`](build-tools/docs/remote-build-setup.md)

## Repo Layout

- `build-tools/`: Buck2/Nix build system, language macros, toolchain helpers, and tests.
- `build-tools/docs/`: build-system reference docs, active designs, and remote-build setup.
- `docs/`: deployment, control-plane, secrets, ADR, task, and handbook documentation.
- `docs/build-history/` and `docs/design-history/`: historical notes and earlier design records.
- `projects/apps/` and `projects/libs/`: application and library roots.
- `patches/`: repo-level patch overlays where a language contract supports global patches.
- `third_party/`: external provider metadata and generated provider glue.
- `toolchains/` and `target_platforms/`: Buck toolchain and platform wiring.

## Build Quickstart

Use the dev helper for normal local work. It runs the startup checks, refreshes generated glue, and
then delegates to Buck:

```bash
nix develop -c build-tools/tools/dev/dev-build.ts build //...
nix develop -c build-tools/tools/dev/dev-build.ts test //...
```

Generate glue directly when you need to refresh the build metadata without running a build:

```bash
node build-tools/tools/dev/install-deps.ts --glue-only
```

For more detail, read:

- [`build-tools/docs/build-system-design.md`](build-tools/docs/build-system-design.md)
- [`docs/handbook/testing.md`](docs/handbook/testing.md)
- [`build-tools/tools/ci/run-stage.ts`](build-tools/tools/ci/run-stage.ts) for the CI stage runner
- [`docs/handbook/patching.md`](docs/handbook/patching.md)
- [`docs/handbook/new-language-walkthrough.md`](docs/handbook/new-language-walkthrough.md)

## Go Quickstart

Go builds are one supported language surface in the broader build system. Scaffold examples:

```bash
scaf new go lib demo-lib --yes --path=projects/libs/demo-lib
scaf new go cli demo-cli --yes --path=projects/apps/demo-cli
```

Generate the module lock and refresh glue:

```bash
build-tools/tools/bin/gomod2nix --dir projects/apps/demo-cli
cp projects/apps/demo-cli/gomod2nix.toml gomod2nix.toml
node build-tools/tools/dev/install-deps.ts --glue-only
```

Go patching is package-local. Place patches under the owning target's package directory, for
example `<pkg>/patches/go/`, with filenames like
`golang.org__x__net@v0.24.0.patch`.
