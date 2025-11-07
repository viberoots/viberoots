# Node Testing (nix_node_test)

This repo provides a hermetic Node test runner integrated with Buck2 via a Nix derivation that executes Vitest in a sandbox using per‑importer node_modules and the pinned Node toolchain.

## Usage

- Add a test target in your importer `TARGETS` using the macro:

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
  - `node tools/buck/export-graph.ts`
  - `node tools/buck/sync-providers-node.ts`
  - `node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`
