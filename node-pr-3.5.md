## Completing PR 3.5 — Node templates using nix_node_test with auto‑discovery

This proposal closes the remaining gaps to fully implement and validate PR 3.5 from `nix-node-test.md`: migrate Node scaffolding templates to rely on the hermetic `nix_node_test` external runner with default discovery, avoid legacy test shims, and add focused zx tests.

### Goals

- Default new Node projects (lib/cli/webapp) to Buck2 tests via `nix_node_test`, using runner defaults that “pass with no tests”.
- Keep importer scoping and provider auto‑wiring; ensure lockfile label is present and canonical.
- Provide sample Vitest tests out of the box, while allowing an opt‑out.
- Add zx tests that exercise both “no tests” and “with tests” scenarios for lib/cli/webapp.

### Out‑of‑scope

- Changing the Node app/webapp build rules themselves; this work is only about test wiring and scaffolding defaults.

---

## Template changes

The current templates already include an optional `nix_node_test` block gated by `includeNodeTests` and add Vitest devDependencies when enabled. Remaining adjustments:

- Always include a `nix_node_test` target by default; expose an explicit opt‑out flag (see Scaffolding CLI below).
  - Keep the existing behavior that the runner succeeds with no tests present.
  - Preserve importer lock label formatting `lockfile:<path>#<importer>` and avoid duplicating other labels the macro stamps.
- Keep the existing sample `test/` files (Vitest) that demonstrate passing tests.
- Update `package.json` templates to default to `vitest run` for `test` scripts and include `vitest`, `esbuild`, and `@types/node` in devDependencies by default (since tests are now defaulted on).
  - Provide a `--no-tests` opt‑out to omit the test script and devDependencies.

Example TARGETS (lib):

```python
load("//node:defs.bzl", "nix_node_lib", "nix_node_test")

nix_node_lib(
    name = "{{ name }}",
    srcs = [],
    out = "build.stamp",
    cmd = "echo ok > $OUT",
    lockfile_label = "lockfile:{{ lockfilePath }}#{{ importer }}",
)

nix_node_test(
    name = "unit",
    lockfile_label = "lockfile:{{ lockfilePath }}#{{ importer }}",
)
```

Notes:

- The `nix_node_lib` stays for build ergonomics; the change here is ensuring test wiring is standardized and present by default.

## Scaffolding CLI behavior

To make tests default‑on without surprising users, add a simple opt‑out flag and keep the current switch for compatibility:

- Default: generate with tests on (emit `nix_node_test`, sample test file, and vitest devDependencies).
- Flags:
  - `--no-tests` (or `includeNodeTests=false`) — do not write `nix_node_test`, remove sample test files, set the `test` script to Node’s built‑in runner (or omit).

CLI examples:

```bash
# default-on: includes nix_node_test and Vitest sample
scaf new node lib my-lib --yes

# explicit opt-out
scaf new node webapp demo-web --yes --no-tests
```

## Tests to add (zx)

Add tests that validate both the presence of tests and the empty-suite fast‑pass across lib/cli/webapp. All tests run inside temp repos with the standard glue flow and Buck2 test invocation.

- lib: scaffold with tests (default)
  - Run glue (export graph → sync providers → gen auto_map) if not implicit in test helper.
  - `buck2 test //libs/<name>:unit` succeeds; Vitest sample passes.
  - With `COVERAGE=1 buck2 test …` ensure the Nix runner completes (optional: spot‑check for coverage artifacts via a separate `nix build .#node-test.<importer>` if needed).

- cli: scaffold with tests (default)
  - `buck2 test //apps/<name>:unit` succeeds.
  - Optional: add a failing sample test then assert Buck test fails (proves failure propagation).

- webapp: scaffold with tests (default)
  - `buck2 test //apps/<name>:unit` succeeds with Vitest sample.

- no‑tests fast‑pass (lib/cli/webapp)
  - Scaffold with `--no-tests` and run `buck2 test …`; should pass with “no tests matched”.

Implementation notes:

- Reuse the existing “no tests” zx tests but switch from “manually append `nix_node_test`” to relying on templates (default on) and/or `--no-tests` for the empty‑suite path.
- Keep the lockfile hashing warm‑up steps where needed (existing helpers already handle importer lock presence).

## Documentation updates

Refresh `docs/handbook/node-tests.md` and template READMEs to:

- Show `nix_node_test` as the default generated test rule.
- Mention default discovery patterns and “pass with no tests” behavior.
- Show how to enable coverage (`COVERAGE=1`) and the external timeout policy.
- Document `--no-tests`.

## Acceptance criteria

- Scaffolding (lib/cli/webapp) includes `nix_node_test` by default and runs via Buck2 with Vitest sample tests passing.
- Opt‑out flag generates projects without tests that still pass the test target due to `passWithNoTests` behavior.
- zx tests cover: lib/cli/webapp with tests; lib/cli/webapp without tests; at least one failing test scenario for failure propagation; (optional) coverage on a simple suite.
- Lockfile labels remain importer‑scoped and canonical; auto‑map/provider glue remains effective.

## Rollout plan

1. Template flips: default `includeNodeTests=true`; add opt‑out `--no-tests` mapping in scaffolding CLI.
2. Update zx tests to rely on template defaults and add with‑tests cases.
3. Docs refresh for defaults and flags.
4. Land after green CI (Node nix runner zx tests + existing scaffolding tests).

## Risks and mitigations

- Larger devDependencies in newly scaffolded projects: acceptable given tests default on; opt‑out available.
- Different local expectations about runners: templates pin Vitest; users can still customize at call sites.
- Coverage artifact verification via Buck: if awkward to assert from test output, verify via `nix build .#node-test.<importer>` in a dedicated zx test.

## Follow‑ups (optional)

- Consider reducing duplication across templates by factoring a common `node-tests` partial (Jinja include) for TARGETS and package.json snippets.
- Add a smoke test that ensures the template `unit` target name does not collide with other rules and is discoverable by `buck2 targets`.
