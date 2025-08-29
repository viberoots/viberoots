## Hermetic, reproducible node_modules with PNPM + Nix (and how we reduce rebuild churn)

This document captures the exact approach we use to make `node_modules` immutable, reproducible, and fast to consume across developers and CI. It also explains how we minimize rebuild churn, especially when small or insignificant changes happen to `pnpm-lock.yaml`.

### Goals

- **Hermetic installs**: no network, pinned toolchain, reproducible outputs.
- **Immutable output**: `node_modules` live in the Nix store; the workspace sees only a symlink.
- **Fast local UX**: the dev shell auto‑links `node_modules` and exposes `.bin` on `PATH`.
- **Low churn**: avoid rebuilds unless the effective dependency graph changes; keep lockfile noise from triggering unnecessary work.

---

## Architecture

- **pnpm-store (fixed‑output derivation, FOD)**
  - Runs `pnpm fetch --frozen-lockfile` to prefetch all tarballs referenced by `pnpm-lock.yaml` into `$out/store`.
  - Uses a fixed `outputHash` keyed by the lockfile to make the store content‑addressed and cacheable.

- **node-modules (derivation)**
  - Uses the prefetched store via `pnpm install --offline --frozen-lockfile` to materialize `node_modules` and `.pnpm`.
  - Copies the resulting directories into its output under the Nix store (read‑only).

- **devShell linking**
  - On entry, resolves the `.#node-modules` output and symlinks `./node_modules` to it.
  - Prepends `node_modules/.bin` to `PATH` for CLIs.
  - Never runs an installer in the shell hook (pure symlink only).

---

## Key Nix snippets (what we actually use)

Clean source and pin toolchain:

```nix
let
  pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
  node = pkgs.nodejs_22;
  pnpm = pkgs.pnpm;
  src = pkgs.lib.cleanSourceWith {
    src = ./.;
    # Include everything except node_modules (see Churn section for a more minimal src)
    filter = path: type: (builtins.match ".*/node_modules(/.*)?" path == null);
  };
in
```

Fixed‑output pnpm store (FOD):

```nix
pnpm-store = pkgs.stdenvNoCC.mkDerivation {
  pname = "pnpm-store";
  version = "lock-${builtins.hashFile "sha256" ./pnpm-lock.yaml}";
  inherit src;
  nativeBuildInputs = [ node pnpm ];
  outputHashMode = "recursive";
  # First build prints the correct hash; we update this value
  outputHash     = "sha256-REPLACE_ME_ON_FIRST_BUILD";
  unpackPhase = ''
    runHook preUnpack
    cp -r ${src} source
    chmod -R u+rwX source
    cd source
    runHook postUnpack
  '';
  buildPhase = ''
    runHook preBuild
    export SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
    export NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
    export NODE_EXTRA_CA_CERTS=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
    export HOME=$(pwd)/.home
    mkdir -p "$HOME"
    # Critical: keep store only under $out so FOD output does not reference other store paths
    pnpm config set store-dir "$out/store"
    pnpm fetch --frozen-lockfile
    runHook postBuild
  '';
};
```

Offline install bound to the FOD:

```nix
node-modules = pkgs.stdenvNoCC.mkDerivation {
  pname = "node-modules";
  version = "lock-${builtins.hashFile "sha256" ./pnpm-lock.yaml}";
  inherit src;
  nativeBuildInputs = [ node pnpm ];
  unpackPhase = ''
    runHook preUnpack
    cp -r ${src} source
    chmod -R u+rwX source
    cd source
    runHook postUnpack
  '';
  buildPhase = ''
    runHook preBuild
    export SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
    export NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
    export NODE_EXTRA_CA_CERTS=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
    export HOME=$(pwd)/.home
    mkdir -p "$HOME"
    pnpm config set store-dir "${pnpm-store}/store"
    pnpm install --offline --frozen-lockfile
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p $out
    if [ -d node_modules ]; then cp -R node_modules $out/; fi
    if [ -d .pnpm ]; then cp -R .pnpm $out/; fi
    runHook postInstall
  '';
  passthru.lockHash = builtins.hashFile "sha256" ./pnpm-lock.yaml;
};
```

Dev shell: best‑effort link only, no installation:

```nix
devShells.default = pkgs.mkShell {
  packages = with pkgs; [ pnpm nodejs_22 ];
  shellHook = ''
    # Link Nix-built node_modules for IDEs/CLIs (read-only)
    if [ -e node_modules ] && [ ! -L node_modules ]; then
      echo "(devShell) existing non-symlink node_modules detected; not overwriting" >&2 || true
    else
      out_path=$(nix build .#node-modules --no-link --accept-flake-config --print-out-paths 2>/dev/null || true)
      if [ -n "$out_path" ]; then
        ln -sfn "$out_path/node_modules" node_modules || true
        if [ -d "$out_path/node_modules/.bin" ]; then
          export PATH="$out_path/node_modules/.bin:$PATH"
        fi
      fi
    fi
  '';
};
```

Helper to auto‑update the FOD hash when the lockfile changes:

```bash
tools/dev/update-pnpm-hash.ts
```

---

## Package patching (reproducible)

Use PNPM’s native `patchedDependencies` so patches are part of the lockfile and flow through the same Nix pipeline:

```bash
pnpm patch <pkg>@<version>
# edit temp dir ...
pnpm patch-commit /path/to/temp/dir
# commit patches/*, package.json, pnpm-lock.yaml
```

Rebuild:

```bash
nix build .#pnpm-store --no-link      # update FOD hash if prompted (or run tools/dev/update-pnpm-hash.ts)
nix build .#node-modules
nix develop                            # links node_modules automatically
```

---

## Reducing rebuild churn

Even small deltas in `pnpm-lock.yaml` change its hash. We employ several techniques so those changes don’t cause pointless or frequent rebuilds:

- **Keep the shell hook pure (no installers)**
  - The hook only symlinks a cached output; `nix build` becomes a no‑op when up‑to‑date, so entering the shell does not rebuild.

- **Pin the toolchain and environment**
  - Use Node and PNPM from Nix to avoid per‑developer differences rewriting the lockfile.
  - Export CA cert variables and set `HOME` inside the build dir to remove machine‑specific noise.

- **Minimize the Nix input set to what truly affects resolution**
  - Our current `src` excludes `node_modules`. For further churn reduction you can restrict to lock/materialization inputs only:

  ```nix
  src = pkgs.lib.cleanSourceWith {
    src = ./.;
    filter = path: type:
      # include only lockfile, root package.json, and patches/**
      (builtins.match ".*/pnpm-lock.yaml" path != null)
      || (builtins.match ".*/package.json" path != null)
      || (builtins.match ".*/patches(/.*)?" path != null);
  };
  ```

  - This prevents unrelated repo edits from re‑hashing the derivations and triggering work on shell entry.

- **Adopt a stable lockfile workflow**
  - Update deps via `pnpm install --lockfile-only` inside the Nix dev shell (pinned PNPM/Node).
  - Avoid ad‑hoc lockfile rewrites (e.g., switching PNPM versions). Prefer a single pinned PNPM version.
  - If you routinely see whitespace/order churn, consider a pre‑commit check that rejects non‑semantic lockfile diffs.

- **Scope invalidation for large monorepos (optional)**
  - If you have many workspaces, consider generating importer‑scoped providers or even separate `node-modules` per importer keyed to its effective subset. This keeps changes in one workspace from invalidating all consumers.

With the above, rebuilds happen only when the effective dependency graph changes. Minor text‑only edits to files outside the resolution set won’t affect derivation hashes; and even when the lockfile changes, dev shells won’t “rebuild on activation” unless there’s genuinely new content to realize.

---

## Troubleshooting

- “Fixed‑output derivations must not reference store paths”
  - Ensure the FOD writes all content under `$out/store` and nothing in `$out` embeds other store paths.
  - Use `pnpm config set store-dir "$out/store"` in the FOD and keep `HOME` within the build dir.

- Shell doesn’t link `node_modules`
  - Check for a real (non‑symlink) `./node_modules` directory and remove/replace as needed.
  - Verify `nix build .#node-modules --no-link --print-out-paths` returns a path.

- Native addon build failures during install
  - Add compilers/tooling to `nativeBuildInputs` of `node-modules` or prefer packages that ship prebuilt binaries.

---

## Quick reference

- Build store once (update FOD hash if prompted):
  - `nix build .#pnpm-store --no-link` → `tools/dev/update-pnpm-hash.ts`
- Build `node_modules` (immutable in Nix store):
  - `nix build .#node-modules`
- Use in dev shell (auto‑links and adds `.bin` to PATH):
  - `nix develop`
- Patch a dependency reproducibly:
  - `pnpm patch …` → edit → `pnpm patch-commit …` → commit patches + lockfile
