### Go/C++ Local Patching — Per‑Target DX Aligned with PNPM Importer‑Scoped Patching

This document replaces global patching for Go and C++ with a local, per‑target approach that mirrors PNPM’s importer‑scoped developer experience. Patches live next to the targets that consume them, invalidation is precise, and sparse checkouts naturally work because all required inputs live within the target’s directory.

---

### Goals

- Align Go/C++ patching DX with Node’s importer‑scoped flow (per directory/target).
- Ensure Buck invalidates only the targets that reference the local patches.
- Keep Nix hermetic and deterministic; no reliance on repo‑wide scans.
- Eliminate the need for Go/C++ provider wiring driven by global patch directories.

### Non‑Goals

- Backwards compatibility with global `patches/go/**` or `patches/cpp/**` (project has no existing users).
- Changing Node’s importer‑scoped provider system (that remains as‑is).

---

### Conventions

- Local patch directories live under the target package tree:
  - Go: `<pkg-or-feature>/patches/go/*.patch`
  - C++: `<pkg-or-feature>/patches/cpp/*.patch`

- Targets may declare one or more patch directories. A sensible default is `patches/<lang>` at the target’s package root.

- Go patch filename format (PNPM‑like encoding retained):
  - `<importPath with '/' → '__'>@<version>.patch`
  - Example: `golang.org__x__net@v0.24.0.patch`
  - Rationale: the Go Nix template derives a `moduleKey = importPath@version` from filenames to attach patches deterministically.

---

### Buck Macros (Go/C++)

We extend the macros to accept target‑local patch inputs and include them in `srcs` so Buck invalidates precisely.

- Go: `nix_go_library`, `nix_go_binary`, `nix_go_test`
  - New attribute: `local_patch_dirs = ["patches/go"]` (list of strings; default resolves relative to the rule’s package).
  - Macro behavior:
    - `srcs += glob([f + "/*.patch" for f in local_patch_dirs])`
    - Pass `local_patch_dirs` to the Nix template as `patchDirs` (a list), not a single global directory.
    - No Go provider deps are added based on patches (provider wiring is removed for Go patching).

- C++: `nix_cxx_library`, `nix_cxx_binary`, `nix_cxx_test`
  - New attribute: `local_patch_dirs = ["patches/cpp"]` (list of strings).
  - Macro behavior:
    - `srcs += glob([f + "/*.patch" for f in local_patch_dirs])`
    - Forward the resolved patch file list (or directories) to the Nix builder as `patches`.
    - No C++ provider deps are used for patching.

Effect: Editing a patch file under a target’s local directory re‑executes only that target and its reverse deps.

---

### Nix Templates (Go)

Update `build-tools/tools/nix/lang-templates.nix` so Go derivations accept multiple local patch directories and drop the global default path.

Key changes:

- Replace `patchDir ? ../../patches/go` with `patchDirs ? []`.
- Build `patchesMap` from all directories in `patchDirs`.

Example sketch:

```nix
{ pkgs }:
let
  lib = pkgs.lib;
  patchesMapFromDirs = patchDirs: let
    scan = dir: let
      names = if builtins.pathExists dir then builtins.attrNames (builtins.readDir dir) else [];
      isPatch = name: lib.hasSuffix ".patch" name;
      toKey = name: let
        base = lib.removeSuffix ".patch" name;
        parts = lib.splitString "@" base;
        impEnc = lib.concatStringsSep "@" (lib.take (lib.length parts - 1) parts);
        ver    = lib.last parts;
        importPath = lib.replaceStrings ["__"] ["/"] impEnc;
      in lib.toLower "${importPath}@${ver}";
      step = acc: name: let key = toKey name; val = (acc.${key} or []) ++ [ "${dir}/${name}" ]; in acc // { "${key}" = val; };
    in builtins.foldl' step {} (lib.filter isPatch names);
    merge = a: b: lib.foldlAttrs (acc: k: v: acc // { "${k}" = (acc.${k} or []) ++ v; }) a b;
  in lib.foldl' merge {} (map scan patchDirs);
in {
  goApp = { name, modulesToml, patchDirs ? [], devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON", subdir ? "." }:
    let patchesMap = patchesMapFromDirs patchDirs;
        devOverrides = let v = builtins.getEnv devOverrideEnv; in if v == "" then {} else builtins.fromJSON v;
        _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
              builtins.throw "Dev overrides are forbidden in CI"
            else null;
    in pkgs.buildGoApplication {
      pname = "go-${name}";
      version = "0.1.0";
      src = ./.;
      modules = modulesToml;
      subPackages = [ subdir ];
      overrides = module: old: old // {
        patches = (old.patches or []) ++ (patchesMap.${module} or []);
        src     = devOverrides.${module} or old.src;
      };
    };

  goLib = args: goApp args; # same behavior for simplicity
}
```

Dev overrides policy:

- Preserve the existing behavior: when `NIX_GO_DEV_OVERRIDE_JSON` is set, warn locally and fail in CI (`CI=true`). This allows fast local iteration while ensuring CI remains deterministic and cacheable.

---

### Nix Builder (C++)

Ensure the C++ derivation accepts a `patches` list and applies them via the standard Nix `patches` attribute. The Buck macro either resolves the concrete list of patch files or passes directories for the builder to glob deterministically.

Example sketch:

```nix
stdenv.mkDerivation {
  pname = name;
  version = "0.1.0";
  src = ./.;
  # patches: [ ./patches/cpp/foo.patch ./patches/cpp/bar.patch ]
  inherit patches;
  # ... rest of builder ...
}
```

---

### Provider and Auto‑map Changes

- Remove Go/C++ provider wiring that existed only to reflect global patch files.
- Keep Node’s importer‑scoped providers and `auto_map.bzl` unchanged.
- Update `build-tools/tools/buck/gen-auto-map.ts` to stop mapping Go `module:` labels to providers; only Node `lockfile:` labels are mapped. The Go exporter remains authoritative for labels (diagnostics) but is not used for provider mapping for patching.

---

### Pre‑build Guard Updates

- Drop checks that enforce Go/C++ provider files derived from global `patches/**`.
- Retain Node guard behavior.
- Optional: warn (non‑fatal) when a target declares `local_patch_dirs` that are empty, to help users place patches in the right location.

---

### patch‑pkg UX (Go/C++)

- Default to local mode:
  - `patch-pkg start go --target //<pkg>:name <module>`
    - Prepares a temp workspace for the module and opens `$PATCH_EDITOR` (optional).
  - `patch-pkg apply go --target //<pkg>:name <module>`
    - Writes a unified diff into `<pkg>/patches/go/<encoded-import>@<version>.patch`.
    - No provider sync step is needed for Go/C++; a rebuild suffices.
  - C++ follows the same shape, landing patches under `<pkg>/patches/cpp`.

- Session mode mirrors the above with Ctrl-D to apply and Ctrl-C to discard.

Rationale: Keeping patches local to the target makes intent explicit and naturally scoping invalidation.

Patch directory resolution:

- `patch-pkg` infers the patch directory from the target’s package path plus `/patches/<lang>` by default. For multiple directories, pass `--patch-dir` to select explicitly. The tool creates the directory if it does not exist.

---

### Sparse/Partial Checkouts

Because patches live under each target’s directory and are included in that target’s `srcs`, sparse checkouts that include the target implicitly include its patches. No repo‑wide scans are required for Go/C++.

---

### PR Sequence (No Backwards Compatibility Needed)

Each PR is small, testable, and independently valuable.

1. PR: Add local patching to Go/C++ macros and Nix
   - Changes:
     - Add `local_patch_dirs` to `nix_go_*` and `nix_cxx_*` macros.
     - Include `glob([d + "/*.patch"])` in `srcs`.
     - Wire `patchDirs` (Go) and `patches` (C++) into Nix builders.
   - Tests:
     - Unit tests for macro expansion (srcs include local patches).
     - Minimal Nix build smoke tests using dummy patches.
   - Acceptance:
     - Editing a local patch file invalidates only the owning targets.

2. PR: Remove global Go/C++ provider wiring and glue
   - Changes:
     - Delete/disable any Go/C++ provider generation previously tied to global `patches/**`.
     - Simplify `build-tools/tools/buck/sync-providers.ts` to focus on Node only.
     - Update `build-tools/tools/buck/gen-auto-map.ts` docs/comments to clarify Go/C++ no longer use providers for patching.
   - Tests:
     - Ensure Node provider sync remains green.
   - Acceptance:
     - Buck builds/tests succeed with only local Go/C++ patching in place.

3. PR: Update patch‑pkg for Go/C++ local mode
   - Changes:
     - Default Go/C++ handler to local patch directories (no global fallback).
     - On `apply`, write to target’s `patches/<lang>` and skip provider sync for Go/C++.
   - Tests:
     - zx tests: start → apply → rebuild; ensure only affected targets rebuild.
   - Acceptance:
     - Smooth developer workflow without global state.

4. PR: Documentation and scaffolding
   - Changes:
     - Add this document and reference it from the handbook.
     - Update scaffolding to generate `patches/go` or `patches/cpp` per new component.
   - Tests:
     - Scaffolding smoke test creates patch directories and sample patch.
   - Acceptance:
     - New projects have correct local patch layout by default.

5. PR: E2E invalidation and sparse‑checkout tests
   - Changes:
     - Add an e2e test that modifies a local patch and verifies precise invalidation via `buck2 cquery testsof(rdeps(...))`.
     - Add a sparse‑checkout test that includes only the target dir and validates builds.
   - Acceptance:
     - Precise invalidation proven; sparse workflows verified.

6. (Optional) PR: Exporter cleanups
   - Changes:
     - Keep Go module labels for diagnostics only; remove any dead code paths that assumed provider mapping for Go patches.
   - Acceptance:
     - No behavior change; smaller surface area.

---

### Acceptance Criteria (Program Level)

- Go/C++ patches live under target directories; no global Go/C++ patch folders are referenced by the build.
- Editing a local patch invalidates only targets that declare the corresponding `local_patch_dirs`.
- Node’s importer‑scoped provider system and auto‑map are unchanged and fully functional.
- CI remains authoritative; local prebuild guard no longer checks global Go/C++ provider files.

---

### Roll‑forward Plan

Because there are no current users, migration is immediate once the PRs land. If needed, a temporary compatibility warning can be emitted when global Go/C++ patch directories are detected, guiding contributors to move patches under their target directories.
