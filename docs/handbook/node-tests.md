## Node tests (nix_node_test)

This repository standardizes Node tests through a Nix-backed runner that executes Vitest hermetically per importer (app/lib). Buck orchestrates which tests run; Nix ensures how they run with pinned toolchains.

- **Runner**: Vitest (pinned via flake)
- **Default patterns**: `test/**/*.test.(ts|js)`, `__tests__/**/*.test.(ts|js)`, `src/**/*.test.(ts|js)`
- **Importer scoping**: Each test target must carry one `lockfile:<path>#<importer>` label.

### Build graph invariants (macro authoring)

`nix_node_test(...)` shells out to Nix inside the external runner. To keep invalidation correct, it must attach `global_nix_inputs()` (for example `flake.lock`) as **real action inputs**, not only as labels.

In this repo, Node importer-scoped, non-genrule, Nix-calling macros must route through `prepare_language_wiring(...)` with `wiring = "non_genrule_nix_calling"` so importer wiring and global input wiring stay consistent and non-mutating at the call site.

### Running

- Buck (single target):
  ```bash
  direnv exec . buck2 test //<path>:unit
  ```
- Buck with coverage:
  ```bash
  direnv exec . buck2 test //<path>:unit -- --env COVERAGE=1
  ```

### Artifacts

When tests pass, the Nix derivation writes artifacts under its output path:

- JUnit report: `$OUT/report/junit.xml`
- Coverage (when `COVERAGE=1`):
  - `$OUT/coverage/lcov.info`
  - `$OUT/coverage/coverage-summary.json`
  - `$OUT/coverage/html/` (HTML report)

To locate `$OUT`, you can build the derivation and print the path:

```bash
nix build .#node-test.<importer-sanitized> --no-link --print-out-paths
```

The `<importer-sanitized>` segment must use the canonical sanitizer (`build-tools/tools/lib/sanitize.ts:sanitizeName`) to stay in parity with `build-tools/tools/nix/lib/lang-helpers.nix:sanitizeName`.

### Notes

- The runner resolves `vitest` strictly from the importer’s `node_modules` (hermetic, no PATH fallbacks). If files match patterns but `vitest` is not installed, the build fails with a clear error.
- If no files match patterns, the test passes (pass-with-no-tests semantics).
- For full-suite coverage, follow the repo convention:
  ```bash
  direnv exec . buck2 test //... -- --env COVERAGE=1
  ```

# Node Testing (nix_node_test)

This repo provides a hermetic Node test runner integrated with Buck2 via a Nix derivation that executes Vitest in a sandbox using per‑importer node_modules and the pinned Node toolchain.

## Usage

- Add a test target in your importer `TARGETS` using the macro (scaffolding generates this by default):

```starlark
load("//node:defs.bzl", "nix_node_test")

nix_node_test(
    name = "unit",
    lockfile_label = "lockfile:<path/to/pnpm-lock.yaml>#<importer>",
)
```

- Default discovery patterns:
  - `test/**/*.test.ts`, `test/**/*.test.js`
  - `__tests__/**/*.test.ts`, `__tests__/**/*.test.js`
  - `src/**/*.test.ts`, `src/**/*.test.js`

- Scaffolded projects include this test target and Vitest sample tests by default. Opt out of sample tests and devDependencies with `--no-tests` when running `scaf new node ...` (the test target remains; the runner passes with no tests).

- Run:

```bash
buck2 test //<importer>:unit
```

## Coverage

- Off by default. Enable per run:

```bash
COVERAGE=1 buck2 test //<importer>:unit -- --env COVERAGE=1
```

Coverage artifacts are emitted under the derivation output.

## Timeouts

- The external runner enforces a default 600s timeout per test target. Override via `timeout_sec` in the macro call if needed.

## Troubleshooting

- No tests matched: the runner passes (useful during bootstrap).
- Tests matched, Vitest missing: add `vitest` to devDependencies for the importer.
- Lockfile/provider glue: re-run glue stages if lockfiles change:
  - `node build-tools/tools/buck/export-graph.ts`
  - `node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`
  - `node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`
