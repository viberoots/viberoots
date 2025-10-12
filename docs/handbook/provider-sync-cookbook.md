### Provider sync cookbook

Provider sync maps patch files under `patches/<lang>` to Buck providers used in builds. Keep it deterministic and idempotent.

- **Patch filenames**: `<module path with / → __>@<version>.patch` (dots are preserved).
- **Sync command**: `node tools/buck/sync-providers.ts --out third_party/providers/TARGETS.auto`.
- **Idempotency**: re-running should not change output when inputs are unchanged.
- **Tests**: create a single patch using fixtures and assert stable provider name and paths.

Useful helpers:

- `providerNameForModuleKey("github.com/stretchr/testify", "v1.9.0")` to compute labels.
- `tools/tests/lib/fixtures/go.ts: ensurePatch()` to create a patch with correct filename.
- For nixpkgs providers, use the shared helpers in `tools/lib/providers.ts`:
  - `normalizeNixAttr(attr)` ensures a canonical `pkgs.`-prefixed, lowercased attr (maps `pkgs.gtest` → `pkgs.googletest`).
  - `providerNameForNixAttr(attr)` derives the deterministic provider name (e.g., `pkgs.zlib` → `nix_pkgs_pkgs_zlib`).

### Shared Nix helpers (templates-common)

For Nix templates that need to apply patches or support dev overrides, import the shared helpers once:

```nix
# tools/nix/templates/<lang>.nix
{ pkgs }:
let
  lib = pkgs.lib;
  Common = import ../templates-common.nix { inherit pkgs; };
in {
  buildFn = args:
    let
      patchesMap = Common.patchesMapFromDir args.patchDir;
      devOverrides = Common.readDevOverrides (args.devOverrideEnv or "");
      _ = Common.guardNoDevOverridesInCI (args.devOverrideEnv or "");
    in pkgs.stdenv.mkDerivation { /* … use patchesMap/devOverrides … */ };
}
```

- `patchesMapFromDir`: builds `{ "module@version" = [ /abs/patch1 … ] }` from `patches/<lang>/*.patch` (flat dir).
- `readDevOverrides ENV`: parses JSON from `ENV` (empty → `{}`); traces a warning locally when non-empty.
- `guardNoDevOverridesInCI ENV`: throws in CI when overrides are present.

These helpers keep behavior consistent across languages and reduce boilerplate in each template.
