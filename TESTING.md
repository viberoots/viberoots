# Testing

## Fast runs (default)

Coverage is disabled by default for speed.

- Run all tests:

```
buck2 test //...
```

## Runs with coverage

Enable coverage explicitly using `COVERAGE=1`.

- Run all tests with coverage and generate reports in `coverage/`:

```
COVERAGE=1 buck2 test //...
```

- Print a summary to the console (after a covered run):

```
pnpm coverage:summary
```

- Open the HTML report (after a covered run):

```
open coverage/lcov-report/index.html  # macOS
# or use the coverage:summary script with --open-browser
pnpm coverage:summary --open-browser
```

Notes:

- Coverage uses raw V8 output from test processes and aggregates via `c8`.
- Reports land in `coverage/` and are Git-ignored.
- For CI, prefer enabling coverage in specific jobs rather than always-on.
