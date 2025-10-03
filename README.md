# Go build — Nix‑first quickstart

This repo wires Go builds with Buck2 orchestrating “what” and Nix deciding “how”. Third‑party dependencies are resolved by `gomod2nix.toml` (no vendoring), and tests validate Nix‑built artifacts using a manifest.

## Quickstart (CLI + lib)

1. Scaffold

```
scaf new go lib demo-lib --yes --path=libs/demo-lib
scaf new go cli demo-cli --yes --path=apps/demo-cli
```

2. Generate module lock and copy to repo root (authoritative)

```
tools/bin/gomod2nix --dir apps/demo-cli
cp apps/demo-cli/gomod2nix.toml gomod2nix.toml
```

3. Glue (strict: export graph → providers → auto_map)

- Glue is not committed and has no planner fallback. Always regenerate before Nix builds.
- Use the helper to run all steps in order:

```
node tools/dev/install-deps.ts --glue-only
```

4. Build via Nix and run from manifest

```
nix build .#graph-generator
jq -r '.[] | select(.label=="//apps/demo-cli:demo-cli") | .bins[0]' buck-go/manifest.json
```

5. Dev build helper (runs startup check, glue refresh, then Buck)

```
# Examples
nix develop -c tools/dev/dev-build.ts build //...
nix develop -c tools/dev/dev-build.ts cquery deps\(//...,\ 1\)
```

Notes

- No vendoring: do not copy `.go` files into `third_party/go/**`.
- Dev overrides: use `NIX_GO_DEV_OVERRIDE_JSON` locally; CI forbids it.
- Planner has no discovery fallback; it consumes `tools/buck/graph.json` only.
- Testing and coverage: see `docs/handbook/testing.md`.

### Adding a Go test file (auto‑wired)

- Generate a minimal, passing test with the scaffolding CLI:

```
scaf new go test handlers --path=libs/demo-lib/pkg/demo-lib/handlers_test.go
scaf new go test main_case --path=apps/demo-cli/cmd/demo-cli/main_case_test.go
```

- Auto‑wiring rules (no TARGETS edits):
  - Libs: tests under `libs/<lib>/pkg/<pkg>/**/_test.go` are discovered and bound to `//libs/<lib>:<lib>_test`.
  - Apps: tests under `apps/<app>/cmd/<app>/**/_test.go` are discovered and bound to `//apps/<app>:<app>_test`.
  - Package name is inferred from existing files; under `/cmd/` it defaults to `main`.

Further reading: `build-system-design.md`, `docs/handbook/`.

CI stage runner reference: `tools/ci/run-stage.ts`.
