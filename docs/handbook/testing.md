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
