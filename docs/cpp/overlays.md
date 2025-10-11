## C++ overlays and patching (nixpkgs)

This guide explains how to enable and use the C++ overlays entry-point to apply local patches to nixpkgs C/C++ packages, in a way that aligns with our build philosophy and hermetic workflows.

### What you get

- **Conditional overlay wiring**: If `tools/nix/overlays/cpp-patches.nix` exists, it is automatically included by `flake.nix`.
- **Local patch application**: Keep patches under `patches/cpp/*.patch` and apply them to nixpkgs packages via the overlay.
- **Buck/Nix integration**: Prebuild freshness detection includes `tools/nix/overlays/*.nix` and `flake.lock`, ensuring changes are noticed and tested.

### Repository layout

```
patches/
  cpp/
    your-fix-1.patch
    your-fix-2.patch
tools/
  nix/
    overlays/
      cpp-patches.nix   # overlay entry-point (you write overrides here)
```

### 1) Enable the overlay (no-op by default)

`flake.nix` conditionally includes the C++ overlay if `tools/nix/overlays/cpp-patches.nix` is present. The file is intentionally minimal by default. Create or edit it to add overrides.

Example skeleton you can adapt:

```nix
# tools/nix/overlays/cpp-patches.nix
final: prev: let
  apply = pkg: patches: final.applyPatches {
    inherit pkg patches;
    name = "cpp-patched-${pkg.pname or "pkg"}";
  };
in {
  # Example: patch zlib with a local patch file
  # Path note: this file lives at tools/nix/overlays/cpp-patches.nix,
  # so repo-root is ../../../ from here.
  # zlib = apply prev.zlib [ ../../../patches/cpp/zlib-fix-build.patch ];

  # Add more overrides as needed, keeping entries deterministic and sorted.
}
```

Tips:

- Keep the list of overrides sorted for reproducibility.
- Prefer small, focused patches and upstream them when possible.

### 2) Add or update patches

Place patch files under `patches/cpp/`. Names are free-form; use clear, descriptive names.

- Example: `patches/cpp/openssl-compat-3_2.patch`

### 3) Regenerate provider glue (optional)

For completeness you can refresh provider glue. The C++ provider sync writes a small generated file:

```bash
# From repo root
node tools/buck/sync-providers.ts --lang=cpp
```

This emits `third_party/providers/TARGETS.cpp.auto` with a generated header. No manual edits are required.

### 3.5) Creating patches with patch-pkg (recommended)

For a guided workflow, use the patch helper to create canonical unified diffs for nixpkgs C/C++ packages. The tool maintains sessions and workspaces for you.

Commands:

```bash
# Start a session for a nixpkgs attribute (both forms accepted)
tools/bin/patch-pkg start cpp pkgs.zlib
# or
tools/bin/patch-pkg start cpp zlib

# Make edits under the printed workspace path, then:
tools/bin/patch-pkg apply cpp zlib

# If you want to discard the session/workspace:
tools/bin/patch-pkg reset cpp zlib

# Interactive session: Ctrl-D applies, Ctrl-C resets
tools/bin/patch-pkg session cpp zlib
```

What it does:

- Creates a writable workspace cloned from the nix store source for the package.
- Generates a canonical unified diff into `patches/cpp/<attr>@<version>.patch`.
- Verifies the patch applies cleanly with `patch -p1 --dry-run`.
- Prints an overlay snippet you can paste into `tools/nix/overlays/cpp-patches.nix`.

### 4) Validate and test

- Run language diagnostics to confirm C++ is enabled and visibility is intact:

```bash
direnv exec . node tools/dev/langs-diagnose.ts
```

- Run the full test suite (local convention):

```bash
direnv exec . timeout 600s buck2 test //... --target-platforms config//platforms:default -- --env COVERAGE=1
```

Notes on invalidation and freshness:

- The prebuild guard tracks `tools/nix/overlays/*.nix` and `flake.lock`, so changes trigger the expected rebuilds.
- You do not need a dedicated stamp target; freshness is covered by the existing guard and inputs scanning.

### 5) Example: patch zlib

1. Add a patch file:
   - `patches/cpp/zlib-darwin-arm64-build-fix.patch`
2. Wire it in the overlay:

```nix
# tools/nix/overlays/cpp-patches.nix
final: prev: let
  apply = pkg: patches: final.applyPatches {
    inherit pkg patches;
    name = "cpp-patched-${pkg.pname or "pkg"}";
  };
in {
  zlib = apply prev.zlib [ ../../../patches/cpp/zlib-darwin-arm64-build-fix.patch ];
}
```

3. Re-run tests:

```bash
direnv exec . timeout 600s buck2 test //... --target-platforms config//platforms:default -- --env COVERAGE=1
```

### Troubleshooting

- If you see unspecified platform errors during ad-hoc runs, set the default platform explicitly as above with `--target-platforms config//platforms:default`.
- If changes seem ignored, ensure your overlay file exists at `tools/nix/overlays/cpp-patches.nix` and that patch paths are correct relative to that file.
- For CI, these overlays are captured by our hermetic Nix builds and Buck change detection.

### Design alignment

- Respects hermeticity and reproducibility: patches live in-repo, overlays are explicit, and inputs are tracked.
- Plays well with Buck2 orchestration and Nix dynamic derivations.
- Minimal surface area: one overlay entry-point, one patches directory, zero manual stamps.
