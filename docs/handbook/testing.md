# Testing Handbook

## Conventions

- One test per file.
- External timeouts: 40s per test, 180s for full suite.
- Use zx `#!/usr/bin/env zx-wrapper` for tests.

## Coverage

- Enable: `COVERAGE=1` via Buck test executor `-- --env COVERAGE=1`.
- Open report: `pnpm coverage:open` after full run.

## Running

- Full: `timeout -k 10s 180s buck2 test //...`
- Specific: `buck2 test //<target>`
 
## Go dependencies (gomod2nix)

- After editing `go.mod` or `go.sum`, run:
  - `node tools/dev/install-deps.ts` (regenerates `gomod2nix.toml` deterministically)
- Preview without changes:
  - `node tools/dev/install-deps.ts --dry-run`