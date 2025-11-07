{ pkgs, repoRoot, repoFsRoot, hashesPath, prefetchedStorePathGlobal ? null }:
let
  common = import ./common.nix { inherit pkgs repoRoot repoFsRoot hashesPath prefetchedStorePathGlobal; };
  store = import ./store.nix { inherit pkgs repoRoot repoFsRoot hashesPath prefetchedStorePathGlobal; };
  lib = common.lib;
  node = pkgs.nodejs_22;
  pnpm = pkgs.pnpm;
  certs = pkgs.cacert;
  dirnameOf = common.dirnameOf;
  importerOnlySrc = common.importerOnlySrc;
  mkPnpmStore = store.mkPnpmStore;
  inherit repoRoot repoFsRoot prefetchedStorePathGlobal;
in {
  mkNodeModules = { lockfilePath, importerDir, npmrcPath ? null, packageJsonPath ? null, prefetchedStorePath ? prefetchedStorePathGlobal }:
    let
      relLock = lockfilePath;
      relLockDir = dirnameOf relLock;
      src = importerOnlySrc { inherit importerDir; lockfilePath = relLock; };
      store = mkPnpmStore { inherit lockfilePath importerDir npmrcPath packageJsonPath prefetchedStorePath; };
      lockAbsStrStore = "${repoRoot}/${relLock}";
      lockAbsStrFs = "${repoFsRoot}/${relLock}";
      hasLockFs = builtins.pathExists lockAbsStrFs;
      hasLockStore = builtins.pathExists lockAbsStrStore;
      lockInput = if hasLockFs then (builtins.path { path = lockAbsStrFs; name = "pnpm-lock.yaml"; }) else (if hasLockStore then (builtins.path { path = lockAbsStrStore; name = "pnpm-lock.yaml"; }) else null);
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "node-modules";
      version = if (hasLockFs || hasLockStore) then "lock-${builtins.hashFile "sha256" (if hasLockFs then lockAbsStrFs else lockAbsStrStore)}" else "lock-missing";
      inherit src;
      nativeBuildInputs = [ node pnpm ];
      preferLocalBuild = true;
      allowSubstitutes = false;
      unpackPhase = ''
        runHook preUnpack
        cp -r $src source
        chmod -R u+rwX source
        echo "[nix] mkNodeModules: tree under filtered src (max depth 3)"
        (cd source && find . -maxdepth 3 -type d -print | sort)
        # Ensure we run inside the importer directory so pnpm sees package.json
        cd source/${importerDir}
        echo "[nix] mkNodeModules: entered $(pwd)"
        ls -la
        runHook postUnpack
      '';
      buildPhase = ''
        runHook preBuild
        # quiet: reduce verbose diagnostics
        export SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
        export NIX_SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
        export NODE_EXTRA_CA_CERTS=${certs}/etc/ssl/certs/ca-bundle.crt
        export HOME=$(pwd)/.home
        mkdir -p "$HOME"
        export COREPACK_ENABLE=0
        export COREPACK_ENABLE_AUTO_PIN=0
        export PNPM_HOME="$HOME/.pnpm-home"
        mkdir -p "$PNPM_HOME"
        # Strip packageManager to prevent corepack/pnpm self-bootstrap loops inside hermetic builds
        node -e 'const fs=require("fs"); const p="package.json"; if(fs.existsSync(p)){const j=JSON.parse(fs.readFileSync(p,"utf8")); delete j.packageManager; fs.writeFileSync(p, JSON.stringify(j, null, 2));}'
        # Use a writable local copy of the prefetched/fetched store to avoid EACCES when pnpm
        # attempts to create internal versioned subdirectories (e.g., v10) under the store.
        LOCAL_STORE="$HOME/.pnpm-store"
        mkdir -p "$LOCAL_STORE"
        if [ -d "${store}/store" ]; then
          # Best-effort copy; the store is content-addressed and can be read-only in FODs
          cp -R "${store}/store/." "$LOCAL_STORE/" || true
        fi
        pnpm config set store-dir "$LOCAL_STORE"
        # Do not rely on pnpm cache from the store output; resolve strictly from lockfile + store
        # Ensure a lockfile is present: prefer using the exported lockfile from pnpm-store
        if [ ! -f pnpm-lock.yaml ]; then
          if [ -f "${store}/lockfile/pnpm-lock.yaml" ]; then
            echo "[nix] mkNodeModules: using exported lockfile from store"
            cp "${store}/lockfile/pnpm-lock.yaml" pnpm-lock.yaml
          elif [ -f ${if lockInput != null then "${lockInput}" else "/nonexistent"} ]; then
            echo "[nix] mkNodeModules: injecting importer lockfile input"
            cp ${if lockInput != null then "${lockInput}" else "/nonexistent"} pnpm-lock.yaml
          elif [ "${builtins.getEnv "NIX_PNPM_ALLOW_GENERATE"}" = "1" ]; then
            echo "[nix] mkNodeModules: offline install to create lockfile (allow-generate)"
            PNPM_HOME="$PNPM_HOME" pnpm install --offline --no-frozen-lockfile --ignore-scripts --prod=false --lockfile-dir "." --dir "."
          else
            echo "[nix] mkNodeModules: no lockfile present and generation not allowed; failing"
            exit 3
          fi
        else
          # Install strictly from the fixed-output store for the specific importer (relative to importer root)
          # Force inclusion of devDependencies so tool binaries (e.g., vite) are available
          PNPM_HOME="$PNPM_HOME" pnpm install --offline --frozen-lockfile --ignore-scripts --prod=false --lockfile-dir "." --dir "."
        fi
        echo "[nix] mkNodeModules: install complete"
        echo "[nix] mkNodeModules: listing node_modules/.bin"
        ls -la node_modules/.bin || true
        echo "[nix] mkNodeModules: listing node_modules/vite"
        ls -la node_modules/vite || true
        runHook postBuild
      '';
      installPhase = ''
        runHook preInstall
        mkdir -p $out
        if [ -d node_modules ]; then
          cp -R node_modules $out/
        fi
        if [ -d .pnpm ]; then
          cp -R .pnpm $out/
        fi
        runHook postInstall
      '';
      passthru.lockHash = if (hasLockFs || hasLockStore) then builtins.hashFile "sha256" (if hasLockFs then lockAbsStrFs else lockAbsStrStore) else "";
    };
}
