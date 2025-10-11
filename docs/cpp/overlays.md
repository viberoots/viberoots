## C++ overlays and patching (nixpkgs)

This guide explains how to enable and use the C++ overlays entry-point to apply local patches to nixpkgs C/C++ packages, in a way that aligns with our build philosophy and hermetic workflows.

### Intended workflow

Use `tools/bin/patch-pkg` as the canonical way to create and manage C++ (nixpkgs) patches. It:

- Creates a writable workspace cloned from the nix store source for a nixpkgs attr
- Generates a canonical patch file under `patches/cpp/<attr>@<version>.patch`
- Verifies the patch applies cleanly (`patch -p1 --dry-run`)
- Prints an overlay snippet to paste into `tools/nix/overlays/cpp-patches.nix`

Directly hand-writing patch files is possible but discouraged; prefer `patch-pkg` for consistency and correctness.

### What you get

- **Conditional overlay wiring**: If `tools/nix/overlays/cpp-patches.nix` exists, it is automatically included by `flake.nix`.
- **Local patch application**: Keep patches under `patches/cpp/*.patch` and apply them to nixpkgs packages via the overlay.
- **Buck/Nix integration**: Prebuild freshness detection includes `tools/nix/overlays/*.nix` and `flake.lock`, ensuring changes are noticed and tested.

### Quickstart (example-driven)

This hands-on walkthrough shows how to create, enable, and validate a patch for `zlib` using our overlay.

1. Create and edit a workspace

```bash
# Start a session for the nixpkgs attribute
tools/bin/patch-pkg start cpp zlib

# The command prints a workspace path. Edit files under that path, e.g.:
# Example: bump the reported version string
sed -i '' 's/#define ZLIB_VERSION \".*\"/#define ZLIB_VERSION \"9.9.9-bucknix\"/' "$PRINTED_WORKSPACE/zlib.h"
```

2. Generate the patch

```bash
tools/bin/patch-pkg apply cpp zlib

# This writes a canonical patch file under patches/cpp/ named:
#   pkgs_zlib@<version>.patch
# and prints an overlay snippet to paste.
```

3. Enable the patch in the overlay

Create `tools/nix/overlays/cpp-patches.nix` (if not present) and add the snippet:

```nix
# tools/nix/overlays/cpp-patches.nix
final: prev: let
  patchedSrc = final.applyPatches {
    name = "cpp-patched-zlib";
    src = prev.zlib.src;
    patches = [ ../../../patches/cpp/pkgs_zlib@1.2.13.patch ]; # adjust filename
  };
in {
  zlib = prev.zlib.overrideAttrs (old: { src = patchedSrc; });
}
```

4. Validate

```bash
# Option A: smoke-test with our suite
v

# Option B: quick ad-hoc build using the overlay
nix eval --impure --raw --expr '(import <nixpkgs> { overlays = [ (import ./tools/nix/overlays/cpp-patches.nix) ]; }).zlib.version'

# Option C: compile a tiny program against the patched headers (for APIs like zlib)
cat > main.c <<'EOF'
#include <stdio.h>
#include <zlib.h>
int main(){ printf("%s\n", ZLIB_VERSION); return 0; }
EOF
nix shell --impure --expr 'with import <nixpkgs> { overlays = [ (import ./tools/nix/overlays/cpp-patches.nix) ]; }; [ zlib pkg-config ]' \
  --command sh -c 'cc main.c -o zver $(pkg-config --cflags --libs zlib) && ./zver'
```

5. Iterate or clean up

```bash
# If needed, re-open a session and repeat apply
tools/bin/patch-pkg session cpp zlib   # Ctrl-D to apply, Ctrl-C to reset

# To discard the session/workspace
tools/bin/patch-pkg reset cpp zlib
```

—

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

Example skeleton you can adapt (preferred pattern):

```nix
# tools/nix/overlays/cpp-patches.nix
final: prev: let
  # Build a patched source from the upstream src and local patches
  patched = name: src: patches: final.applyPatches {
    inherit src patches;
    name = "cpp-patched-${name}";
  };
in {
  # Example: patch zlib with a local patch file
  # Path note: this file lives at tools/nix/overlays/cpp-patches.nix,
  # so repo-root is ../../../ from here.
  # zlib = prev.zlib.overrideAttrs (old: {
  #   src = patched "zlib" prev.zlib.src [ ../../../patches/cpp/zlib-fix-build.patch ];
  # });

  # Add more overrides as needed, keeping entries deterministic and sorted.
}
```

Tips:

- Keep the list of overrides sorted for reproducibility.
- Prefer small, focused patches and upstream them when possible.

### 2) Add or update patches (via patch-pkg)

The recommended path is to use `tools/bin/patch-pkg` to generate patches. It writes to `patches/cpp/` automatically using the convention `<attr>@<version>.patch`, e.g. `pkgs_zlib@1.2.13.patch`.
If you must add a patch manually, keep it under `patches/cpp/` and follow the same naming convention.

### 3) Regenerate provider glue (optional)

For completeness you can refresh provider glue. The C++ provider sync writes a small generated file:

```bash
# From repo root
node tools/buck/sync-providers.ts --lang=cpp
```

This emits `third_party/providers/TARGETS.cpp.auto` with a generated header. No manual edits are required.

### 3.5) Creating patches with patch-pkg (recommended, canonical)

For a guided workflow, use the patch helper to create canonical unified diffs for nixpkgs C/C++ packages. The tool maintains sessions and workspaces for you.

Commands (canonical flow):

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
- Generates a canonical unified diff into `patches/cpp/<attr>@<version>.patch` (matching Go's convention).
- Verifies the patch applies cleanly with `patch -p1 --dry-run`.
- Prints an overlay snippet you can paste into `tools/nix/overlays/cpp-patches.nix`.

Step-by-step:

1. Start a session for the nixpkgs attribute you want to patch (e.g., `zlib`). This prints a writable workspace path.
2. Edit files under the printed workspace.
3. Run `tools/bin/patch-pkg apply cpp <attr>` to generate/update the patch file.
4. Copy the printed overlay snippet into `tools/nix/overlays/cpp-patches.nix` (or adapt the example below) and save.
5. Run the tests to validate.

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

1. Add a patch file (either generated by the tool or by hand), for example:
   - `patches/cpp/pkgs_zlib@1.2.13.patch`
2. Wire it in the overlay (overrideAttrs + applyPatches on src):

```nix
# tools/nix/overlays/cpp-patches.nix
final: prev: let
  patched = name: src: patches: final.applyPatches {
    inherit src patches;
    name = "cpp-patched-${name}";
  };
in {
  zlib = prev.zlib.overrideAttrs (old: {
    src = patched "zlib" prev.zlib.src [ ../../../patches/cpp/pkgs_zlib@1.2.13.patch ];
  });
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

Checklist before committing:

- Patch lives under `patches/cpp/` with a descriptive name.
- Overlay entry is added in `tools/nix/overlays/cpp-patches.nix` using overrideAttrs + applyPatches on src.
- `tools/dev/langs-diagnose.ts` shows C++ providers and any patched entries (optional).
- Full suite passes: `v` (dev shell) with 600s external timeout and coverage.

### Design alignment

- Respects hermeticity and reproducibility: patches live in-repo, overlays are explicit, and inputs are tracked.
- Plays well with Buck2 orchestration and Nix dynamic derivations.
- Minimal surface area: one overlay entry-point, one patches directory, zero manual stamps.
