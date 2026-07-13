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
  - Explicit reconciliation runs pinned `pnpm fetch --frozen-lockfile` inside the FOD to prefetch all tarballs referenced by `pnpm-lock.yaml` into `$out/store`.
  - Uses a fixed `outputHash` keyed by the lockfile to make the store content‑addressed and cacheable.
  - Ordinary install, post-clone, link, and devshell paths only validate the committed realized FOD; they never enable fetch or reconciliation.

- **node-modules (derivation)**
  - Uses the prefetched store via `pnpm install --offline --frozen-lockfile` to materialize `node_modules` and `.pnpm`.
  - Copies the resulting directories into its output under the Nix store (read‑only).

- **devShell linking**
  - On entry, I only reuse a cached marker or an existing symlink.
  - I do not run `nix eval` in the shell hook.
  - I never run an installer in the shell hook (pure symlink only).

### Dev shell marker and relink checks

I write a marker at `buck-out/tmp/node-modules-link.root.json` when I link `node_modules` from the repo root. The marker stores the importer, lockfile path, lockfile hash, and Nix output path. On entry, I only trust the marker or an existing `node_modules` symlink. If the lockfile changes or the marker is missing, I skip linking. To refresh the link, I run `build-tools/tools/bin/i`.

---

## Key Nix snippets (what we actually use)

Clean source and pin toolchain (minimal, resolution-only inputs):

```nix
let
  pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
  node = pkgs.nodejs_22;
  pnpm = pkgs.pnpm;
  # Include only files that affect dependency resolution and patches
  src = pkgs.lib.cleanSourceWith {
    src = ./.;
    filter = path: type:
      (builtins.match ".*/pnpm-lock.yaml" path != null)
      || (builtins.match ".*/package.json" path != null)
      || (builtins.match ".*/pnpm-workspace.yaml" path != null)
      || (builtins.match ".*/\\.npmrc" path != null)
      || (builtins.match ".*/patches/node(/.*)?" path != null);
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
    # Fetch exactly from the lockfile (no extra flags, no recursion/filters)
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

Notes:

- Do not copy or clone the fixed-output store into a local directory in `node-modules`. Point `store-dir` directly to `${pnpm-store}/store`; PNPM will read from it and only write to working dirs (`node_modules`, `.pnpm`).
- Run `pnpm fetch` from the repository/workspace root. Avoid `--recursive`, `--filter`, or `--prod/--dev/--optional` in the FOD; these can exclude importers and cause missing tarballs.

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

Explicit helper to reconcile the FOD hash and realized output when the lockfile changes:

```bash
build-tools/tools/dev/update-pnpm-hash.ts
```

Ordinary `i` materialization invokes this helper in read-only mode. It may realize and link ignored
local state, but it does not regenerate a lockfile or rewrite pnpm hash metadata. If the committed
lock or hash metadata is stale, or its fixed store output is absent, installation fails closed,
names the stale input, and reports `repair: run u`. Intentional reconciliation owns the committed
fixed-store hash and realized output authority. It accepts one targeted Nix hash mismatch, refreshes
the filtered input after the hash write, and verifies the result before success. Scaffold flows must
run that reconciliation before their first locked/offline materialization.

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
nix build .#pnpm-store --no-link      # update FOD hash if prompted (or run build-tools/tools/dev/update-pnpm-hash.ts)
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
      # include only lockfile, root package.json, workspace + npmrc, and patches/pnpm/**
      (builtins.match ".*/pnpm-lock.yaml" path != null)
      || (builtins.match ".*/package.json" path != null)
      || (builtins.match ".*/pnpm-workspace.yaml" path != null)
      || (builtins.match ".*/\\.npmrc" path != null)
      || (builtins.match ".*/patches/node(/.*)?" path != null);
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

## Hardening checklist

- CA certificates and HOME inside builds
  - Set `SSL_CERT_FILE`, `NIX_SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS` to `${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt`.
  - Set `HOME=$(pwd)/.home` and `mkdir -p "$HOME"` in both derivations.
- Pin toolchain
  - Use PNPM and Node from Nix (`pkgs.pnpm`, `pkgs.nodejs_22`). Prefer matching the lockfile generator version (same major/minor).
  - If formats drift, regenerate `pnpm-lock.yaml` inside `nix develop`.
- `.npmrc` stability
  - If you customize `node-linker`, `virtual-store-dir`, scopes/registries, or auth, keep `.npmrc` under version control and include it in the FOD `src` (as shown above).
- Dev shell PATH
  - After linking, prepend `node_modules/.bin` to `PATH` so scripts resolve without any install steps.

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

## Notes on Node patches and importer placement

- Use `patches/node` for Node patches. Place importer‑local patches under `<importer>/patches/node/*.patch` when working in a multi‑importer workspace (e.g., `apps/web/patches/node/…`). The Node provider generator includes only patches relevant to each importer’s effective set, and the Node macros include importer‑local patches in target `srcs` so Buck invalidates precisely.

---

## Quick reference

- Build store once (update FOD hash if prompted):
  - `nix build .#pnpm-store --no-link` → `build-tools/tools/dev/update-pnpm-hash.ts`
- Build `node_modules` (immutable in Nix store):
  - `nix build .#node-modules`
- Use in dev shell (auto‑links and adds `.bin` to PATH):
  - `nix develop`
- Patch a dependency reproducibly:
  - `pnpm patch …` → edit → `pnpm patch-commit …` → commit patches + lockfile
