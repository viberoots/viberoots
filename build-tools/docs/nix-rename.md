## Proposal: Rename nixpkgs Provider Prefix from `nix_pkgs_*` to `nix_*`

This document proposes a careful, low-risk migration of the C++/general Nix provider family prefix from `nix_pkgs_*` to `nix_*`. The change is cosmetic (shorter names) but must be executed comprehensively to avoid inconsistent wiring or invalidation drift.

### Goals

- **Primary**: Replace the provider family prefix `nix_pkgs_` with `nix_`, while preserving the canonical attribute tail derived from normalized nixpkgs attributes (e.g., `pkgs.openssl` → `nix_pkgs_pkgs_openssl` becomes `nix_pkgs_openssl` renamed to `nix_pkgs_openssl`? See below).
- **Consistency**: Maintain compatibility with the existing labeling and mapping flows, especially the `nixpkg:<attr>` labels in exported graphs.
- **Safety**: Provide an alias window so downstream code using old names keeps working during rollout.
- **Determinism**: Keep rule key behavior predictable and invalidation accurate.

### Non-Goals

- Changing the canonical nixpkgs attribute normalization (we keep `normalizeNixAttr`: ensure `pkgs.` prefix, map `pkgs.gtest → pkgs.googletest`, lower-case, trim).
- Changing other provider families (e.g., `mod_*` for module patches, `lf_*` for lockfile/importer providers).

---

## Current State (Before)

- Provider family for nixpkgs-backed providers is `nix_pkgs_`.
- Canonical name shape for a nixpkgs attribute `attr` is:
  - tail = `normalizeNixAttr(attr)` → `[^a-z0-9]+` replaced by `_`
  - name = `nix_pkgs_${tail}`
  - Examples:
    - `pkgs.openssl` → `nix_pkgs_pkgs_openssl`
    - `pkgs.zlib` → `nix_pkgs_pkgs_zlib`
    - `pkgs.googletest` → `nix_pkgs_pkgs_googletest`

- Curated providers in `third_party/providers/TARGETS` currently use canonical names (post recent cleanup), and tests/docs reference them.
- `tools/lib/providers.ts` provides `providerNameForNixAttr(attr)` → `nix_pkgs_${tail}` and is used by generators (auto-map, CPP provider sync) and some tests.
- `third_party/providers/nix_attr_map.bzl` is emitted by the CPP provider sync to map provider targets back to canonical `nixpkg:<attr>` labels for planner-visible edges.

---

## Proposed State (After)

- Change the provider family prefix from `nix_pkgs_` → `nix_`.
- Keep the tail logic unchanged (still based on normalized nixpkgs attribute):
  - name = `nix_${tail}` where `tail = normalizeNixAttr(attr).replace(/[^a-z0-9]+/g, "_")`.
  - Examples:
    - `pkgs.openssl` → `nix_pkgs_openssl` becomes `nix_pkgs_openssl`? Under the new rule: `nix_pkgs_openssl` simplifies to `nix_pkgs_openssl` → final name `nix_pkgs_openssl` with family reduction to `nix_` results in `nix_pkgs_openssl`? For clarity, the intent is: `nix_pkgs_pkgs_openssl` (old) → `nix_pkgs_openssl` (intermediate) → `nix_openssl` (final). Concretely:
      - Old canonical: `nix_pkgs_pkgs_openssl`
      - New canonical: `nix_openssl`
    - `pkgs.zlib` → from `nix_pkgs_pkgs_zlib` to `nix_zlib`
    - `pkgs.googletest` → from `nix_pkgs_pkgs_googletest` to `nix_googletest`

Rationale: The family `nix_` is sufficiently descriptive and shorter. Attribute identity is preserved in the tail, and all consumer mappings remain canonical and deterministic.

---

## Impacted Components

1. **Shared Naming Helper**
   - `tools/lib/providers.ts` `providerNameForNixAttr(attr)`
     - Old: `return \`nix*pkgs*${tail}\``
     - New: `return \`nix\_${tail}\``

2. **Generators / Consumers**
   - `tools/buck/gen-auto-map.ts` (reads `nixpkg:<attr>` labels and calls `providerNameForNixAttr`).
   - `tools/buck/providers/cpp.ts` (names providers and emits `nix_attr_map.bzl`).
   - Any other generator referencing `providerNameForNixAttr` must be recompiled and run.

3. **Curated Providers**
   - `third_party/providers/TARGETS` curated entries renamed to the new names (`nix_googletest`, `nix_zlib`, `nix_openssl`).
   - Optional alias file (during migration window) mapping old → new via Starlark `alias` targets.

4. **Auto-Generated Artifacts**
   - `third_party/providers/TARGETS.*.auto` (where present) will emit new names the next time generators run.
   - `third_party/providers/nix_attr_map.bzl` keys will change to reference new provider names.

5. **Docs & Tests**
   - Update examples and scaffolding tests to reference `nix_<tail>`.
   - Keep one test proving the old name aliases (if we provide them) resolve correctly for the migration window.

---

## Migration Plan (Two-Stage, Safe Rollout)

### Stage 1 — Dual-Name Compatibility (Short Window)

- Change `providerNameForNixAttr` to return `nix_${tail}`.
- Update generators to use the new helper (they already do), regenerate local artifacts.
- Rename curated providers in `third_party/providers/TARGETS` to `nix_<tail>`.
- Add a temporary `third_party/providers/TARGETS.aliases` with Starlark `alias` targets mapping each old canonical name → new canonical name, for example:

```starlark
# third_party/providers/TARGETS.aliases (temporary)
alias(name = "nix_pkgs_pkgs_googletest", actual = ":nix_googletest")
alias(name = "nix_pkgs_pkgs_zlib", actual = ":nix_zlib")
alias(name = "nix_pkgs_pkgs_openssl", actual = ":nix_openssl")
```

- The CPP macros primarily consume providers via `NIX_ATTR_MAP` (provider → `nixpkg:<attr>`). That map will be regenerated with the new names immediately; aliases ensure any hand-typed old names still resolve.
- Update all tests and docs to reference the new names (`nix_<tail>`). Keep a small alias-coverage test.
- Run full suite locally and in CI with coverage.

Acceptance (Stage 1):

- All tests green; provider wiring shows only new names in auto outputs and curated files.
- Old names still build via aliases.

### Stage 2 — Remove Aliases (After 1–2 releases)

- Delete `third_party/providers/TARGETS.aliases` (legacy names removed).
- Confirm no references to `nix_pkgs_*` remain in the repo:
  - Search tests, docs, scaffolds.
  - Ensure `nix_attr_map.bzl` contains only new names.
- Run full suite with coverage; finalize.

Acceptance (Stage 2):

- No remaining old-name references and full suite passes.

---

## Detailed Change List

1. `tools/lib/providers.ts`

```ts
// BEFORE
export function providerNameForNixAttr(attr: string): string {
  const norm = normalizeNixAttr(attr);
  const tail = norm.replace(/[^a-z0-9]+/g, "_");
  return `nix_pkgs_${tail}`;
}

// AFTER
export function providerNameForNixAttr(attr: string): string {
  const norm = normalizeNixAttr(attr);
  const tail = norm.replace(/[^a-z0-9]+/g, "_");
  return `nix_${tail}`;
}
```

2. `third_party/providers/TARGETS`

```starlark
# BEFORE (canonical names)
nix_cxx_library(name = "nix_pkgs_pkgs_googletest", attr = "pkgs.googletest")
nix_cxx_library(name = "nix_pkgs_pkgs_zlib",        attr = "pkgs.zlib")
nix_cxx_library(name = "nix_pkgs_pkgs_openssl",     attr = "pkgs.openssl")

# AFTER (new canonical names)
nix_cxx_library(name = "nix_googletest", attr = "pkgs.googletest")
nix_cxx_library(name = "nix_zlib",       attr = "pkgs.zlib")
nix_cxx_library(name = "nix_openssl",    attr = "pkgs.openssl")
```

3. Temporary Aliases (optional, timeboxed)

```starlark
# third_party/providers/TARGETS.aliases
alias(name = "nix_pkgs_pkgs_googletest", actual = ":nix_googletest")
alias(name = "nix_pkgs_pkgs_zlib",        actual = ":nix_zlib")
alias(name = "nix_pkgs_pkgs_openssl",     actual = ":nix_openssl")
```

4. Generators

- `tools/buck/gen-auto-map.ts`: no logic change beyond picking up the new helper result.
- `tools/buck/providers/cpp.ts`: no logic change; it will emit new names via the helper and regenerate `nix_attr_map.bzl`.

5. Tests & Docs

- Update all references to old names. Keep one alias test during Stage 1.

---

## Risks and Mitigations

- **Risk: Stale references to old names**
  - Mitigation: Aliases file for one or two releases; repo-wide grep in CI to fail if old names are introduced post Stage 2.

- **Risk: Name collisions across future Nix families**
  - Mitigation: The family token remains `nix_`. If future families are added (e.g., overlays), we can emit `nix_overlay_<tail>` or extend the helper to parameterize family while keeping `nix_` as the default.

- **Risk: Cache churn**
  - Mitigation: This is a planned, one-time rename. Expect rebuilds once; alias stage reduces disruption to external consumers.

---

## CI & Validation

- Run the normal pipeline:
  1. Export Graph → Sync Providers → Generate auto_map → Prebuild Guard → Build & Test.
  2. Confirm `third_party/providers/TARGETS*.auto` and `nix_attr_map.bzl` contain only the new names after regeneration.
  3. Full test suite with coverage green.

- Add a one-off CI check (Stage 2) to grep the repo for `nix_pkgs_pkgs_` and fail if found.

---

## Rollout Timeline

- **Week 0–1 (Stage 1)**: Implement helper change, curated rename, add aliases, update tests/docs, land once green.
- **Week 2–4**: Monitor; downstreams migrate. Communicate cutoff.
- **Week 5 (Stage 2)**: Remove aliases; enforce repo grep.

---

## Acceptance Criteria

- New canonical provider names `nix_<tail>` are used everywhere.
- Generators regenerate outputs with new names; `nix_attr_map.bzl` and auto TARGETS contain only new names (except during alias stage).
- Tests and docs are updated; full test suite passes with coverage.
- After Stage 2, no remaining references to `nix_pkgs_*` names in repo.

---

## Appendix — Rationale vs. Status Quo

- **Shorter, still explicit**: `nix_` is concise and conveys the Nix source; the attribute tail already encodes `pkgs.`.
- **Future-proofing**: Additional Nix families can be expressed by extending the tail or parameterizing the helper; we aren’t locked into `nix_pkgs_`.
- **Determinism unchanged**: Only provider target names change. Labeling (`nixpkg:<attr>`) and normalization remain identical, preserving the planning model.
