### PR: Cross-language polish (Go/C++) — helpers, DRY Go Nix overrides, unified overrides CLI, startup-check parity

#### Scope

- Unify patch filename encoding helpers across languages.
- DRY repeated Go override/patch mapping logic in `tools/nix/templates/go.nix`.
- Unify the “clear dev overrides” CLI.
- Add C++ dev-override warning parity in startup-check.

#### Non-goals

- No behavior changes to provider label formats or auto-map semantics.
- No changes to exporter behavior, Buck macros, or CI stages.

---

### Design Details

#### 1) Unify patch filename encoding helpers

- File: `tools/lib/providers.ts`
  - Add helpers for C++ patch prefixes, colocated with existing Go helpers:
    - `encodeNixAttrForPatchPrefix(attr: string): string` — map `pkgs.openssl` → `pkgs__openssl`.
    - `decodeNixAttrFromPatchPrefix(prefix: string): string` — reverse to canonical `pkgs.*`.
  - Rationale: single source of truth for patch filename encoding/decoding across languages.

- File: `tools/buck/providers/cpp.ts`
  - Replace local encoder with imports from `tools/lib/providers.ts`.
  - Continue to scan `patches/cpp/<enc>@<ver>.patch` (no change to structure).

- Tests:
  - `tools/tests/lib/providers.encode-nix-attr.roundtrip.test.ts` — roundtrip typical attrs (`pkgs.zlib`, `pkgs.gnome.glib`, `pkgs.openssl`).
  - `tools/tests/lib/providers.encode-go-module.roundtrip.test.ts` — sanity check existing Go helpers remain stable.

Acceptance:

- C++ provider sync resolves the same files as before; only helper location changes.

---

#### 2) DRY Go override/patch mapping logic in `tools/nix/templates/go.nix`

- File: `tools/nix/templates/go.nix`
  - Introduce `mkOverrides = { patchesMap, devMap }:
module: old: old // { patches = (old.patches or []) ++ derivedPatchList; src = derivedSrcOverride; }`.
  - In `goApp`, `goLib`, `goCArchive`:
    - Compute `patchesMap` once.
    - Read `dev = Dev.readJsonOverride { envName = devOverrideEnv; ciForbidden = true; }` once.
    - If `takesOverrides`, set `overrides = mkOverrides { patchesMap = patchesMap; devMap = dev.map; }`.
  - Preserve all other logic (CGo, flags, phases) unchanged.

- Tests:
  - Existing Go patch/apply tests must pass unchanged.
  - Add `tools/tests/dev/go-overrides.key-selection.test.ts`
    - Verifies `module` and `module@version` keys both apply.

Acceptance:

- No change in outputs compared to pre-DRY; code size and duplication reduced.

---

#### 3) Unify “clear dev overrides” CLI

- File: `tools/dev/clear-overrides.ts`
  - Update to clear both `NIX_GO_DEV_OVERRIDE_JSON` and `NIX_CPP_DEV_OVERRIDE_JSON` and print both values after clearing.

- File: `tools/dev/clear-overrides-cpp.ts`
  - Deprecate: replace with a one-liner shim to run `tools/dev/clear-overrides.ts`.
  - Optionally mark for removal in a future cleanup.

- Docs:
  - `docs/handbook/troubleshooting.md` — point users to the unified script.
  - Remove or annotate references to the C++-specific script.

Acceptance:

- One command clears both overrides; old command path continues to work as a shim.

---

#### 4) Startup-check parity for C++ overrides

- File: `tools/dev/startup-check.ts`
  - Mirror Go warning: if `NIX_CPP_DEV_OVERRIDE_JSON` is set locally (not `CI=true`), print a parity warning that local derivation hashes will differ and that CI forbids these overrides.

- Test:
  - `tools/tests/dev/startup-check.cpp-override-warning.test.ts` — asserts warning is printed when `NIX_CPP_DEV_OVERRIDE_JSON` is set, `CI` unset.

Acceptance:

- Local parity warning exists for both Go and C++ overrides.

---

### Commit Plan (Conventional Commits)

1. feat(lib): add C++ patch filename encode/decode helpers; tests

- Files:
  - `tools/lib/providers.ts` — add `encodeNixAttrForPatchPrefix`, `decodeNixAttrFromPatchPrefix` with docs.
  - Tests: `tools/tests/lib/providers.encode-nix-attr.roundtrip.test.ts`.
  - Tests: `tools/tests/lib/providers.encode-go-module.roundtrip.test.ts` (sanity).

2. refactor(cpp): use shared helpers in C++ provider sync; filename encoding test

- Files:
  - `tools/buck/providers/cpp.ts` — remove local encoder; import shared helpers.
  - Tests: `tools/tests/scaffolding/sync-providers.cpp.filename-encoding.test.ts`.

3. refactor(go,nix): DRY override/patch mapping in go.nix; retain behavior

- Files:
  - `tools/nix/templates/go.nix` — factor `mkOverrides` and apply to `goApp`, `goLib`, `goCArchive`.
  - Tests: `tools/tests/dev/go-overrides.key-selection.test.ts`.

4. feat(dev): unify clear-overrides CLI; deprecate C++ script; docs

- Files:
  - `tools/dev/clear-overrides.ts` — clear Go and C++ overrides.
  - `tools/dev/clear-overrides-cpp.ts` — shim to unified script.
  - Docs: `docs/handbook/troubleshooting.md`, any references to the old script.

5. feat(dev): startup-check warns for NIX_CPP_DEV_OVERRIDE_JSON; tests

- Files:
  - `tools/dev/startup-check.ts` — add warning for C++ overrides.
  - Tests: `tools/tests/dev/startup-check.cpp-override-warning.test.ts`.

---

### Self-review checklist

- Unify patch filename encoding helpers — covered by commits (1) and (2).
- DRY repeated Go override/patch mapping logic — covered by commit (3).
- Unify “clear dev overrides” CLI — covered by commit (4); shim ensures BC.
- Startup-check parity for C++ overrides — covered by commit (5).
- Tests added for each area; docs updated where user-facing.

All identified items are covered; no additional changes required.
