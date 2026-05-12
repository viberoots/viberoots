# Contributor Naming Conventions

This document describes the canonical naming rules enforced by the repository's
`stale-names-lint` tool and the `no-stale-viberoots-names.enforcement.test` verification test.

## Canonical repository names

Use these names for all repository identity, packages, plugins, environment variables, and
operational paths:

| Concept                    | Canonical form                           |
| -------------------------- | ---------------------------------------- |
| Product name (lowercase)   | `viberoots`                              |
| Product name (title case)  | `Viberoots`                              |
| Product name (uppercase)   | `VIBEROOTS`                              |
| Short prefix (lowercase)   | `vbr`                                    |
| Short prefix (title case)  | `Vbr`                                    |
| Short prefix (uppercase)   | `VBR`                                    |
| Repository slug            | `viberoots/viberoots`                    |
| Remote URL                 | `git@github.com:viberoots/viberoots.git` |
| Deployment repository path | `/srv/viberoots`                         |

## Stale names blocked in active source

The following names are blocked by the stale-names enforcement and must not appear in active
source files, test files, templates, scaffolds, or operator-facing docs:

- `bucknix`, `Bucknix`, `BUCKNIX`
- `bucknix-fresh`, `kiltyj/bucknix-fresh`
- `git@github.com:kiltyj/bucknix-fresh.git`
- `bnx`, `Bnx`, `BNX` (when used as a word boundary, not inside unrelated identifiers)
- `/srv/common` (deployment host path only)
- `kiltyj/common` (repository slug only)
- `git@github.com:kiltyj/common.git`
- `kiltyj/viberoots` (repository slug only)
- `git@github.com:kiltyj/viberoots.git`

Exceptions: `docs/repo-rename.md`, `docs/runtime-prefix-migration.md`,
`docs/contributor-naming-conventions.md`, `docs/mini-name-migration-instructions.md`,
`pnpm-lock.yaml`, files under `docs/build-history/`, and files under `docs/design-history/`.

## In-house concept names

Use `SprinkleRef` in all prose, identifiers, file names, and doc glossary entries for the repo-owned
deployment input contract. The `secret://`, `config://`, and `runtime://` URI schemes are unchanged:
they are operator-visible serialized identifiers and renaming them would be a breaking change.

## Plan/phase number identifiers

Do not encode completed plan PR numbers or completed plan phase numbers into active code
identifiers, test file names, test descriptions, Buck target names, fixture names, helper
names, convention allowlist keys, or operational command examples.

Use behavior-based names instead. Examples:

| Avoid                                            | Use                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `deployment-control-plane.pr92.docs.test.ts`     | `deployment-control-plane.admission-requirement-discovery.docs.test.ts` |
| `webapp.phase5.dynamic-refresh.contract.test.ts` | `webapp.wasm-dynamic-refresh.contract.test.ts`                          |
| `test("pr91 docs keep ...")`                     | `test("deployment control plane docs keep ...")`                        |

### Allowed uses of numeric labels

- **Plan document headings**: `PR-N` headings in plan documents (`docs/*.md`) are the document's
  planning structure and are not subject to this rule.
- **Operational phase concepts**: `phase0` in deployment code that describes the first
  deployment group in the release pipeline is an active operational concept, not a completed
  plan phase number, and is not subject to this rule.
- **External protocol paths and versions**: HTTP API paths such as `/api/v1`, Vault `/v1` or
  `kv-v2`, npm/Go package versions, Buck `buck-out/v2`, and Git porcelain versions are
  real external identifiers and must not be renamed.
- **Intentionally versioned long-lived schemas**: Schema version numbers that are part of an
  external contract are excluded.

## Migration labels

Do not use `legacy*` identifiers for pre-launch compatibility paths that have no current
external users. Remove the compatibility path or rename it to the behavior it preserves.

Do not use `v1`/`v2` in internal helper, test, fixture, or contract names to mean
"old/new", "first/preferred", or "migration-era". Use a canonical behavior name instead.

Permitted uses of `legacy` and `v1`/`v2`:

- External protocol versions (HTTP API paths, Vault, Buck, Git)
- Third-party package or module version strings
- Reviewed long-lived schemas whose version number is part of the external contract

## Enforcement

The `stale-names-lint` tool runs automatically:

- **Pre-commit** (via `lint-staged`): scans staged `.ts`, `.tsx`, `.bzl`, `.nix`, `.md`,
  JavaScript/data config files, and extensionless `TARGETS` files for stale names.
- **Verify/CI** (via `v`): scans all tracked source files before running Buck tests.

Active docs are checked for stale names everywhere and for completed plan/phase identifiers or
migration labels in command-like examples. Tracked file paths are checked too, so stale names in
filenames fail even when file contents are clean. Historical planning docs are excluded only through
explicit allowlists.

To run the full-source scan manually:

```
zx-wrapper build-tools/tools/dev/stale-names-lint.ts
```

To scan specific files (for example when debugging a pre-commit failure):

```
zx-wrapper build-tools/tools/dev/stale-names-lint.ts build-tools/tools/my-file.ts
```

The verification test `no-stale-viberoots-names.enforcement.test` provides an independent
full-source assertion that runs in the normal `v` / `buck2 test //...` suite.

## Repository Remote Closeout

During rename closeout, local clones should point the `github` remote directly at the canonical
repository:

```
git remote get-url github
git remote get-url --push github
```

Both commands should print:

```
git@github.com:viberoots/viberoots.git
```

## Temporary Rename Inventory

When a large coordinated rename touches identifiers across many files, a temporary rename
inventory may be used during implementation to keep code, tests, targets, docs, allowlists,
and command inventories aligned.

### Inventory format

Each entry in the inventory must have the following fields:

| Field                         | Description                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `stale-token`                 | The exact stale identifier, file path, target name, or command surface being replaced        |
| `replacement`                 | The chosen behavior-based replacement (or `retained-reason` if kept with an allowlist entry) |
| `owning-pr`                   | The PR that performs the rename so concurrent work is not blocked by a half-applied rename   |
| `mechanical-replacement-safe` | `true` if a global find-and-replace is safe; `false` if the token is context-sensitive       |
| `reviewed`                    | `true` once a human has verified the replacement is correct for this specific occurrence     |
| `resolution`                  | One of: `renamed`, `removed`, `retained-in-allowlist` (must be set before the PR merges)     |

Context-sensitive tokens — such as `common`, `legacy`, `v1`/`v2`, `PR-N`, and `phase<N>` — must
have `mechanical-replacement-safe: false` and require a reviewed classification for every
occurrence. Do not apply them as blind global replacements.

### Review policy

Every inventory entry must be resolved before the owning PR merges:

- **`renamed`**: the stale identifier has been replaced with the canonical behavior name across
  all affected files, and the enforcement test confirms the active source is clean.
- **`removed`**: the compatibility path, migration shim, or outdated surface has been deleted.
- **`retained-in-allowlist`**: the identifier is intentionally kept and a narrow allowlist entry
  has been added to `build-tools/tools/dev/stale-names-lint-allowlists.ts` (in `ALLOWED_PATHS`,
  `ALLOWED_PREFIXES`, or `PLAN_NUMBER_SKIP_PATHS`) with a one-line reason explaining why the
  token is not a stale migration artifact (for example, a real external schema version).

### Closeout requirement

**The temporary rename inventory file must be deleted before the owning PR merges.**

Long-term state belongs in enforcement rules, tests, and explicit allowlists — not in a
migration database. If the file is still present, the `rename-inventory.closeout.test` in
`build-tools/tools/tests/linting/` will fail, blocking merge.

Any retained entries must have their allowlist wiring in place before deletion. Running
`zx-wrapper build-tools/tools/dev/stale-names-lint.ts` after deletion confirms no stale identifiers
remain in active source.
