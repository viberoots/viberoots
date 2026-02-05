# Go build — Nix‑first quickstart

This repo wires Go builds with Buck2 orchestrating “what” and Nix deciding “how”. Third‑party dependencies are resolved by `gomod2nix.toml` (no vendoring), and tests validate Nix‑built artifacts using a manifest.

## Repo layout (final)

- `build-tools/` — build system and tooling root
- `build-tools/lang/` — shared Starlark helpers
- `build-tools/tools/` — zx/Node tooling
- `build-tools/docs/` — build-system docs
- `build-tools/docs/lang/` — language design docs
- `projects/apps/` — application roots
- `projects/libs/` — library roots
- `docs/build-history/` — historical build notes
- `patches/` — repo-level patch overlays
- `third_party/` — external provider and vendored metadata
- `toolchains/` — Buck toolchain wiring
- `target_platforms/` — platform definitions

## Quickstart (CLI + lib)

1. Scaffold

```
scaf new go lib demo-lib --yes --path=projects/libs/demo-lib
scaf new go cli demo-cli --yes --path=projects/apps/demo-cli
```

2. Generate module lock and copy to repo root (authoritative)

```
build-tools/tools/bin/gomod2nix --dir projects/apps/demo-cli
cp projects/apps/demo-cli/gomod2nix.toml gomod2nix.toml
```

3. Glue (strict: export graph → unified sync-providers → auto_map)

- Glue is not committed and has no planner fallback. Always regenerate before Nix builds.
- Use the helper to run all steps in order (export-graph → sync-providers orchestrator → gen-auto-map):

```
node build-tools/tools/dev/install-deps.ts --glue-only
```

4. Build via Nix and run from manifest

```
nix build .#graph-generator
jq -r '.[] | select(.label=="//projects/apps/demo-cli:demo-cli") | .bins[0]' buck-go/manifest.json
```

5. Dev build helper (runs startup check, glue refresh, then Buck)

```
# Examples
nix develop -c build-tools/tools/dev/dev-build.ts build //...
nix develop -c build-tools/tools/dev/dev-build.ts cquery deps\(//...,\ 1\)
```

Notes

- No vendoring: do not copy `.go` files into `third_party/go/**`.
- Dev overrides: use `NIX_GO_DEV_OVERRIDE_JSON` locally; CI forbids it.
- Planner has no discovery fallback; it consumes `build-tools/tools/buck/graph.json` only.
- Testing and coverage: see `docs/handbook/testing.md`.
- Adding a new language: read `docs/handbook/new-language-walkthrough.md` for a fast, capability‑gated path using the lang‑kit template.

### Go local patching (canonical)

- Place patches under the target’s package directory: `<pkg>/patches/go/`.
- Filename format: `<importPath with '/' → '__'>@<version>.patch` (e.g., `golang.org__x__net@v0.24.0.patch`).
- Go patches are local-only; no global Go provider files are generated or required. Buck invalidates precisely via `srcs` on the owning target.

### Exporter validation modes (warn | error)

The Buck graph exporter supports a validation severity switch for adapter findings.

- Default behavior: error (non‑zero exit on findings)
- Local warn mode (exits zero):

```
node build-tools/tools/buck/export-graph.ts --validation=warn
# or
EXPORTER_VALIDATION=warn node build-tools/tools/buck/export-graph.ts
```

- CI override: if `CI=true`, findings are always treated as errors regardless of flags/env.

Typical usage during local iteration is warn; CI remains strict for safety.

### Provider index (optional, for introspection/tools)

For tooling and debugging, you can emit a cross‑language provider index that maps each provider target to its origin key.

- Generate alongside provider sync:

```
node build-tools/tools/buck/sync-providers.ts --emit-index
```

- Or generate directly:

```
node build-tools/tools/buck/gen-provider-index.ts --out third_party/providers/provider_index.bzl
```

The generated `third_party/providers/provider_index.bzl` exposes `PROVIDER_INDEX` where each entry looks like:

```
"//third_party/providers:<name>": { "kind": "node|cpp", "key": "lockfile:<path>#<importer>|nixpkg:<attr>" }
```

This file is not required for builds; it is used by build-tools/tools/tests for introspection.

### Adding a Go test file (auto‑wired)

- Generate a minimal, passing test with the scaffolding CLI:

```
scaf new go test handlers --path=projects/libs/demo-lib/pkg/demo-lib/handlers_test.go
scaf new go test main_case --path=projects/apps/demo-cli/cmd/demo-cli/main_case_test.go
```

- Auto‑wiring rules (no TARGETS edits):
  - Libs: tests under `projects/libs/<lib>/pkg/<pkg>/**/_test.go` are discovered and bound to `//projects/libs/<lib>:<lib>_test`.
  - Apps: tests under `projects/apps/<app>/cmd/<app>/**/_test.go` are discovered and bound to `//projects/apps/<app>:<app>_test`.
  - Package name is inferred from existing files; under `/cmd/` it defaults to `main`.

Further reading: `build-tools/docs/build-system-design.md`, `docs/handbook/`.

Related docs:

- Patching Handbook: `docs/handbook/patching.md`
- Adding a Language (walkthrough): `docs/handbook/new-language-walkthrough.md`
- Adding a Language (reference): `docs/handbook/adding-language.md`
- C++ overlays and patching: `docs/cpp/overlays.md`

CI stage runner reference: `build-tools/tools/ci/run-stage.ts`.

## Key concepts (fast)

### Stamping (what it is and why)

- Stamping = macros attach standardized labels to each target, e.g., `lang:go`, `kind:bin|lib|test`.
- Purpose: help the exporter and provider mapping identify language/kind deterministically.
- Benefit: clearer graphs, tighter invalidation, and actionable linting/errors when labels are missing.
- See: `docs/handbook/macro-stamping-cookbook.md`.

### Pipeline stages (human summary)

- Export Graph: freeze the configured Buck graph to `build-tools/tools/buck/graph.json`.
- Sync Providers: generate provider rules from patches/lockfiles with stable names.
- Auto Map: map targets → the exact providers they need (tight invalidation only where needed).
- Prebuild Guard: verify glue exists and is fresh; local auto‑fix, CI fails fast. See `docs/handbook/troubleshooting.md#prebuild-guard-glue-presence--freshness`.
- Nix Build (graph‑generator): build the artifacts hermetically using shared templates.
- Buck Build/Test: orchestrate what’s dirty, build on demand, and run exactly the right tests.

### Nix vs Buck (why both)

- Nix build answers “can the recipe produce the artifact, hermetically?” and warms cache.
- Buck decides “what needs building or testing right now?” across the whole repo graph.
- Locally, you can use Buck alone; CI splits stages for better cache reuse and clearer diagnostics.
- See: `docs/handbook/ci.md` for per‑stage responsibilities.
