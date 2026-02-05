## C++ overlays and patching (nixpkgs)

This guide explains how to enable and use the C++ overlays entry-point to apply local patches to nixpkgs C/C++ packages, in a way that aligns with our build philosophy and hermetic workflows.

### Intended workflow

Use `build-tools/tools/bin/patch-pkg` as the canonical way to create and manage C++ (nixpkgs) patches. It:

- Creates a writable workspace cloned from the nix store source for a nixpkgs attr
- Generates a canonical patch file under `patches/cpp/<encoded>@<version>.patch`
  - Encoding: replace dots in the attr with slashes, then `/` → `__` (e.g., `pkgs.zlib` → `pkgs__zlib`)
- Verifies the patch applies cleanly (`patch -p1 --dry-run`)
- Prints an informational note; no manual overlay snippet is required, as the overlay auto-discovers patches by filename

Directly hand-writing patch files is possible but discouraged; prefer `patch-pkg` for consistency and correctness.

### Dev override (local-only, parity with Go)

For rapid iteration without committing patches, you can point a nixpkgs attr at a local workspace using a temporary environment variable:

```
export NIX_CPP_DEV_OVERRIDE_JSON='{"pkgs.openssl":"/abs/path/to/workspace"}'
```

Notes:

- Local warning is emitted when this variable is set.
- In CI (`CI=true`), dev overrides are forbidden and evaluation will fail.
- Do not commit with this set; it changes derivation hashes locally and is not part of Buck inputs.

Use `build-tools/tools/dev/clear-overrides-cpp.ts` to unset quickly.

### What you get

- **Opt‑in overlay wiring**: If `build-tools/tools/nix/overlays/cpp-patches.nix` exists and `NIX_CPP_USE_OVERLAY=1` is set in the environment, it is included by `flake.nix`. By default, the overlay is not enabled; local patching remains the canonical path.
- **Local patch application**: Keep patches under `patches/cpp/*.patch` and apply them to nixpkgs packages via the overlay.
- **Buck/Nix integration**: Prebuild freshness detection includes `build-tools/tools/nix/overlays/*.nix` and `flake.lock`, ensuring changes are noticed and tested.

### Quickstart (example-driven)

This hands-on walkthrough shows how to create, enable, and validate a patch for `zlib` using our overlay.

1. Create and edit a workspace

```bash
# Start a session for the nixpkgs attribute
build-tools/tools/bin/patch-pkg start cpp zlib

# The command prints a workspace path. Edit files under that path, e.g.:
# Example: bump the reported version string
sed -i '' 's/#define ZLIB_VERSION \".*\"/#define ZLIB_VERSION \"9.9.9-bucknix\"/' "$PRINTED_WORKSPACE/zlib.h"
```

2. Generate the patch

```bash
build-tools/tools/bin/patch-pkg apply cpp zlib

# This writes a canonical patch file under patches/cpp/ named:
#   pkgs__zlib@<version>.patch
# The overlay auto-discovers patches by filename; no snippet is required.
```

3. Enable the overlay

Ensure `build-tools/tools/nix/overlays/cpp-patches.nix` exists, and opt‑in when you want to use it:

```bash
export NIX_CPP_USE_OVERLAY=1
```

No manual edits are required for each patch; the overlay automatically discovers files under `patches/cpp/*.patch` and applies those that match the current nixpkgs version of each attr when the overlay is enabled.

4. Validate

```bash
# Option A: smoke-test with our suite
v

# Option B: quick ad-hoc build using the overlay
nix eval --impure --raw --expr '(import <nixpkgs> { overlays = [ (import ./build-tools/tools/nix/overlays/cpp-patches.nix) ]; }).zlib.version'

# Option C: compile a tiny program against the patched headers (for APIs like zlib)
cat > main.c <<'EOF'
#include <stdio.h>
#include <zlib.h>
int main(){ printf("%s\n", ZLIB_VERSION); return 0; }
EOF
nix shell --impure --expr 'with import <nixpkgs> { overlays = [ (import ./build-tools/tools/nix/overlays/cpp-patches.nix) ]; }; [ zlib pkg-config ]' \
  --command sh -c 'cc main.c -o zver $(pkg-config --cflags --libs zlib) && ./zver'
```

5. Iterate or clean up

```bash
# If needed, re-open a session and repeat apply
build-tools/tools/bin/patch-pkg session cpp zlib   # Ctrl-D to apply, Ctrl-C to reset

# To discard the session/workspace
build-tools/tools/bin/patch-pkg reset cpp zlib
```

—

### Repository layout

```
patches/
  cpp/
    your-fix-1.patch
    your-fix-2.patch
build-tools/tools/
  nix/
    overlays/
      cpp-patches.nix   # overlay entry-point (you write overrides here)
```

### 1) Enable the overlay (opt‑in)

`flake.nix` conditionally includes the C++ overlay only when `build-tools/tools/nix/overlays/cpp-patches.nix` is present and `NIX_CPP_USE_OVERLAY=1` is set in the environment. The file is intentionally minimal by default. Create or edit it to add overrides and export the env var to enable the overlay for a given build or shell session.

The committed overlay file at `build-tools/tools/nix/overlays/cpp-patches.nix` auto-discovers patches; no per-attr snippet is needed. Remember to set `NIX_CPP_USE_OVERLAY=1` to activate it.

Tips:

- Keep the list of overrides sorted for reproducibility.
- Prefer small, focused patches and upstream them when possible.

### 2) Add or update patches (via patch-pkg)

The recommended path is to use `build-tools/tools/bin/patch-pkg` to generate patches. It writes to `patches/cpp/` automatically using the convention `<encoded>@<version>.patch`, e.g. `pkgs__zlib@1.2.13.patch`.
If you must add a patch manually, keep it under `patches/cpp/` and follow the same naming convention.

### 3) Provider glue (no longer required)

As of PR 2 in `docs/cpp/drop-cpp-provider.md`, C++ provider sync is a no‑op. There is no C++ provider file to generate and no stamps to maintain. Use label introspection instead:

```bash
# List effective nixpkg attrs for all C++ targets in the exported graph
node build-tools/tools/buck/inspect-cpp-attrs.ts --json

# Or for specific targets
node build-tools/tools/buck/inspect-cpp-attrs.ts --target //projects/libs/helper-lib:lib --target //projects/apps/bar:bin
```

### 3.5) Creating patches with patch-pkg (recommended, canonical)

For a guided workflow, use the patch helper to create canonical unified diffs for nixpkgs C/C++ packages. The tool maintains sessions and workspaces for you.

Commands (canonical flow):

```bash
# Start a session for a nixpkgs attribute (both forms accepted)
build-tools/tools/bin/patch-pkg start cpp pkgs.zlib
# or
build-tools/tools/bin/patch-pkg start cpp zlib

# Make edits under the printed workspace path, then:
build-tools/tools/bin/patch-pkg apply cpp zlib

# If you want to discard the session/workspace:
build-tools/tools/bin/patch-pkg reset cpp zlib

# Interactive session: Ctrl-D applies, Ctrl-C resets
build-tools/tools/bin/patch-pkg session cpp zlib
```

What it does:

- Creates a writable workspace cloned from the nix store source for the package.
- Generates a canonical unified diff into `patches/cpp/<attr>@<version>.patch` (matching Go's convention).
- Verifies the patch applies cleanly with `patch -p1 --dry-run`.
- Prints an overlay snippet you can paste into `build-tools/tools/nix/overlays/cpp-patches.nix`.

Step-by-step:

1. Start a session for the nixpkgs attribute you want to patch (e.g., `zlib`). This prints a writable workspace path.
2. Edit files under the printed workspace.
3. Run `build-tools/tools/bin/patch-pkg apply cpp <attr>` to generate/update the patch file.
4. Copy the printed overlay snippet into `build-tools/tools/nix/overlays/cpp-patches.nix` (or adapt the example below) and save.
5. Run the tests to validate.

### 4) Validate and test

- Run language diagnostics to confirm C++ is enabled and visibility is intact:

```bash
direnv exec . node build-tools/tools/dev/langs-diagnose.ts
```

- Run the full test suite (local convention):

```bash
direnv exec . timeout 600s buck2 test //... --target-platforms config//platforms:default -- --env COVERAGE=1
```

Notes on invalidation and freshness:

- The prebuild guard tracks `build-tools/tools/nix/overlays/*.nix` and `flake.lock`, so changes trigger the expected rebuilds.
- You do not need a dedicated stamp target; freshness is covered by the existing guard and inputs scanning.

### 5) Example: patch zlib

1. Add a patch file (either generated by the tool or by hand), for example:
   - `patches/cpp/pkgs_zlib@1.2.13.patch`
2. The overlay discovers it automatically when the version matches; no manual wiring is needed.

3. Re-run tests:

```bash
direnv exec . timeout 600s buck2 test //... --target-platforms config//platforms:default -- --env COVERAGE=1
```

### Troubleshooting

- If you see unspecified platform errors during ad-hoc runs, set the default platform explicitly as above with `--target-platforms config//platforms:default`.
- If changes seem ignored, ensure your overlay file exists at `build-tools/tools/nix/overlays/cpp-patches.nix`, that `NIX_CPP_USE_OVERLAY=1` is set, and that patch paths are correct relative to that file.
- For CI, these overlays are captured by our hermetic Nix builds and Buck change detection.

Checklist before committing (overlay is optional; local patches next to targets are canonical):

- Patch lives under `patches/cpp/` with a descriptive name.
- If using overlays: add an entry in `build-tools/tools/nix/overlays/cpp-patches.nix` using overrideAttrs + applyPatches on src, and enable with `NIX_CPP_USE_OVERLAY=1`.
- `build-tools/tools/buck/inspect-cpp-attrs.ts` shows effective nixpkg attributes per C++ target (labels-based).
- Full suite passes: `v` (dev shell) with 600s external timeout and coverage.

### Design alignment

- Respects hermeticity and reproducibility: patches live in-repo, overlays are explicit, and inputs are tracked.
- Plays well with Buck2 orchestration and Nix dynamic derivations.
- Minimal surface area: one overlay entry-point, one patches directory, zero manual stamps.
