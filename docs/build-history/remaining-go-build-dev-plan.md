### Remaining Go Build Dev Plan (PR Series)

This document enumerates the remaining work to finish the Go build wiring consistent with our design philosophy — Buck orchestrates “what,” Nix decides “how,” with gomod2nix as the source of truth and glue running outside Nix.

### Guiding principles

- Nix/`gomod2nix.toml` is authoritative for Go deps and build.
- Buck2 orchestrates: graph export, glue, test execution, change impact.
- No vendoring or copying of third-party sources into `third_party/go`.
- Dev and CI use the same `build-tools/tools/bin/gomod2nix` wrapper and flow.
- E2E runtime tests verify Nix-built artifacts, not Buck-only `go_library` resolution.

---

## PR 1: Stabilize Nix-built CLI binary discovery

Scope

- Teach `build-tools/tools/nix/graph-generator.nix` to emit a manifest and stable symlinks so tests can deterministically locate the CLI binary.
- Prefer manifest-based discovery; keep `$out/bin` symlinks as a fallback.

Implementation

- Emit `$out/manifest.json` listing, per Buck label:
  - `label`, `kind` (`bin`/`lib`), `bins` (absolute paths), `aux` (optional).
- Continue to link all binaries under `$out/bin/`.
- Add stable symlinks for each binary, e.g.:
  - `go-<sanitized_label>` and `<sanitized_label>` (replace `//`, `:`, `/`, spaces with `-`).
- Update `build-tools/tools/tests/scaffolding/go-cli.thirdparty-runtime.test.ts` to:
  - Prefer reading `buck-go/manifest.json` to resolve the CLI path.
  - Fall back to `$out/bin` symlinks and finally a recursive scan.

Acceptance Criteria

- Focused test resolves the CLI from the manifest first try and passes.
- `nix build .#graph-generator` yields stable, human-guessable names in `$out/bin/`.

Risks/Notes

- Ensure manifest generation is cheap and deterministic (pure string construction from existing derivations).

---

## PR 2: Deterministic subPackages resolution

Scope

- Make sub-package selection deterministic for both apps and libs in `build-tools/tools/nix/lang-templates.nix` via `graph-generator.nix` inputs.

Implementation

- In `graph-generator.nix`, compute `subdir` from the Buck label:
  - For `go_binary`: `apps/<name>/cmd/<name>`.
  - For `go_library`: the package directory (e.g., `libs/<name>`).
- Ensure templates still use `src = ../..` (repo root) and `subPackages = [ subdir ]`.

Acceptance Criteria

- `nix build .#graph-generator` produces the CLI binary under `$out/bin/` for `//apps/<name>:<name>`.
- Lib derivations are consistently built using the expected subdir.

Dependencies

- PR 1 (binary discovery) can be reviewed in parallel; both touch `graph-generator.nix` but change different aspects.

---

## PR 3: Remove non-authoritative vendoring and synthetic Buck third_party

Scope

- Remove copying of third-party sources into `third_party/go` and any synthetic Buck targets that attempted to represent external modules.
- Keep provider glue solely for change tracking and invalidations (auto_map + patch providers).

Implementation

- Delete code paths in `build-tools/tools/buck/sync-go-mods.ts` that copy from `GOMODCACHE` or emit third-party targets.
- Ensure macros in `go/defs.bzl` don’t attempt to re-wire external imports via Buck deps; rely on Nix for third-party resolution.

Acceptance Criteria

- No `third_party/go` sources are materialized from `GOMODCACHE`.
- E2E runtime test still passes using the Nix-built binary.

Risks/Notes

- Keep local-library Buck deps (app → local lib) intact; third-party remains Nix-resolved at link/build time.

---

## PR 4: Dev/CI parity for `gomod2nix`

Scope

- Guarantee that lockfile generation is identical across dev/CI and reproducible in tests.

Implementation

- Continue to use `build-tools/tools/bin/gomod2nix` wrapper in `build-tools/tools/dev/install-deps.ts` and tests.
- In tests, generate the lockfile from the CLI module (`apps/<app>`) and copy it to repo root for the planner.
- Keep glue (`export-graph`, `sync-providers`, `gen-auto-map`) as zx scripts invoked by `install-deps`.

Acceptance Criteria

- Wrapper generates `gomod2nix.toml` reliably in sandboxed tests (no PATH hacks).
- Test keeps passing on macOS/Linux runners.

---

## PR 5 (optional): Reduce noisy environment output in tests

Scope

- Lower noise from direnv-not-found lines in zx test harness without altering PATH or adding flakiness.

Implementation

- In `build-tools/tools/tests/lib/test-helpers.ts`, best-effort suppression of non-critical errors when direnv is missing.
- Keep current policy: do not mutate PATH inside tests.

Acceptance Criteria

- Less noisy logs; no behavior change.

---

## PR 6: Documentation alignment

Scope

- Update `build-tools/docs/build-system-design.md` and related docs to reflect the finalized approach.

Implementation

- Emphasize:
  - “Buck decides what; Nix decides how.”
  - Runtime tests validate Nix-built artifacts.
  - No vendoring; providers are for invalidation and patch plumbing, not third-party codegen.
- Cross-link `remaining-go-build-dev-plan.md` for the PR roadmap.

Acceptance Criteria

- Docs match code and tests; reviewers can follow the end-to-end flow easily.

---

## PR 7: Verification and housekeeping

Scope

- Run the focused test and then the full test suite with coverage; prepare a clean, single-topic commit series.

Implementation

- Commands (local):
  - Focused: `buck2 test //:scaffolding_go_cli_thirdparty_runtime`
  - Full with coverage: `rm -rf coverage && buck2 test //... -- --env COVERAGE=1 && pnpm coverage:open`
- Conventional Commits per PR, e.g.:
  - `chore(nix/go): add manifest + stable symlinks for Nix-built binaries`
  - `feat(nix/go): deterministic subPackages from Buck labels`
  - `refactor(go): remove synthetic third_party vendoring in glue`
  - `docs(go): align build-system design with Nix-driven runtime`

Acceptance Criteria

- All tests pass locally; coverage opens; PRs are cohesive and reviewable.

---

## PR 8 (future-friendly): Optional enhancements

Scope

- Add `build-tools/tools/nix/mapping.nix` for custom rule aliases → `{ template, kind }` mapping if needed.
- Emit a small `buck-go/README` explaining outputs for local debugging.

Acceptance Criteria

- Optional, only if we introduce custom rule names or want debugging helpers.

---

### Dependencies, risk, and rollback

- Dependencies
  - PR 1, PR 2 can be parallel-reviewed (both touch `graph-generator.nix`). Coordinate merges.
  - PR 3 should follow once Nix runtime path is validated (PR 1–2).
- Risk
  - Miscomputed `subdir` could yield empty or wrong build outputs. Tests and manifest verify correctness.
  - Removing vendoring must not regress runtime tests; we rely on Nix lockfile and templates.
- Rollback
  - Revert PR 3 first if runtime breakage occurs, keeping PR 1–2 symlink/manifest improvements intact.

---

### Success criteria (end-state)

- E2E runtime test for a CLI that depends on a local lib (using a third-party module) passes using the Nix-built binary.
- No third-party vendoring under Buck; glue remains zx-based and minimal.
- Docs and code match the design; dev and CI use identical flows.
