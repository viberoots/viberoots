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
  mkNodeModules = { lockfilePath, importerDir, npmrcPath ? null, packageJsonPath ? null, prefetchedStorePath ? prefetchedStorePathGlobal, ignoreImporterLock ? false }:
    let
      relLock = lockfilePath;
      relLockDir = dirnameOf relLock;
      src = importerOnlySrc { inherit importerDir; lockfilePath = relLock; };
      store = mkPnpmStore { inherit lockfilePath importerDir npmrcPath packageJsonPath prefetchedStorePath; };
      # Prefer an explicit mkNodeModules argument; fall back to the global arg/env.
      chosenPrefetchedPath = if prefetchedStorePath == null || prefetchedStorePath == "" then prefetchedStorePathGlobal else prefetchedStorePath;
      # Materialize the chosen path into the Nix store so builders can read it in sandbox.
      prefetchedInput = if (chosenPrefetchedPath == null || chosenPrefetchedPath == "") then null else builtins.path { path = chosenPrefetchedPath; name = "prefetched-store"; };
      lockAbsStrStore = "${repoRoot}/${relLock}";
      lockAbsStrFs = "${repoFsRoot}/${relLock}";
      hasLockFs = builtins.pathExists lockAbsStrFs;
      hasLockStore = builtins.pathExists lockAbsStrStore;
      lockInput = if hasLockFs then (builtins.path { path = lockAbsStrFs; name = "pnpm-lock.yaml"; }) else (if hasLockStore then (builtins.path { path = lockAbsStrStore; name = "pnpm-lock.yaml"; }) else null);
      ftVal = let v = builtins.getEnv "NIX_PNPM_FETCH_TIMEOUT"; in if v != "" then v else "180";
      genAllowed = (builtins.getEnv "NIX_PNPM_ALLOW_GENERATE") == "1";
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "node-modules";
      version = if (hasLockFs || hasLockStore) then "lock-${builtins.hashFile "sha256" (if hasLockFs then lockAbsStrFs else lockAbsStrStore)}" else "lock-missing";
      inherit src;
      nativeBuildInputs = [ node pnpm pkgs.coreutils pkgs.findutils ];
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
        export SOURCE_DATE_EPOCH=1
        export TZ=UTC
        echo "[BNX-MKNM-DEBUG] env PATH=$PATH" >&2
        echo "[BNX-MKNM-DEBUG] node=$(command -v node || echo none) pnpm=$(command -v pnpm || echo none)" >&2
        echo "[BNX-MKNM-DEBUG] NODE_VERSION=$(node -v 2>/dev/null || echo none) PNPM_VERSION=$(pnpm -v 2>/dev/null || echo none)" >&2
        if ! command -v timeout >/dev/null 2>&1; then
          echo "[BNX-MKNM-ERROR] 'timeout' not found in PATH; coreutils must provide it in builder env" >&2
          echo "[BNX-MKNM-ERROR] PATH=$PATH" >&2
          exit 127
        fi
        echo "[BNX-MKNM-DEBUG] TIMEOUT_BIN=timeout" >&2
        echo "[BNX-MKNM-DEBUG] begin mkNodeModules buildPhase (importerDir=${importerDir})" >&2
        echo "[BNX-MKNM-DEBUG] CWD=$(pwd)" >&2
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
        # Ensure pnpm cache is confined to the build directory (avoid ~/Library/Caches on darwin).
        export XDG_CACHE_HOME="$HOME/.cache"
        export npm_config_cache="$HOME/.npm-cache"
        mkdir -p "$XDG_CACHE_HOME" "$npm_config_cache"

        # Use a writable local store directory.
        # To avoid copying the huge content-addressed `files/` tree into the build dir,
        # symlink it from the fixed-output store, and copy only the smaller `index/`
        # tree into the local store so pnpm can read/write metadata offline.
        echo "[BNX-MKNM-DEBUG] preparing local pnpm store (symlink files/, copy index/)" >&2
        LOCAL_STORE="$HOME/.pnpm-store"
        mkdir -p "$LOCAL_STORE"

        seed_store() {
          src="$1"
          [ -d "$src" ] || return 0
          for verDir in "$src"/v*; do
            [ -d "$verDir" ] || continue
            ver="$(basename "$verDir")"
            mkdir -p "$LOCAL_STORE/$ver"
            chmod -R u+rwX "$LOCAL_STORE/$ver"
            if [ -d "$verDir/files" ] && [ ! -e "$LOCAL_STORE/$ver/files" ]; then
              ln -s "$verDir/files" "$LOCAL_STORE/$ver/files"
            fi
            if [ -d "$verDir/index" ]; then
              rm -rf "$LOCAL_STORE/$ver/index"
              mkdir -p "$LOCAL_STORE/$ver/index"
              cp -R --no-preserve=mode,ownership "$verDir/index/." "$LOCAL_STORE/$ver/index/"
              chmod -R u+rwX "$LOCAL_STORE/$ver/index"
            fi
          done
        }

        seed_store "${store}/store"
        if [ -d ${if prefetchedInput != null then "\"${prefetchedInput}\"" else "\"/nonexistent\""} ]; then
          seed_store ${if prefetchedInput != null then "\"${prefetchedInput}\"" else "\"/nonexistent\""}
        fi
        pnpm config set store-dir "$LOCAL_STORE"
        FT="${ftVal}"
        echo "[BNX-MKNM-DEBUG] NIX_PNPM_FETCH_TIMEOUT=$FT" >&2
        echo "[BNX-MKNM-DEBUG] lockfile_present=$(test -f pnpm-lock.yaml && echo yes || echo no)" >&2
        if [ -f pnpm-lock.yaml ]; then echo "[BNX-MKNM-DEBUG] head -n5 pnpm-lock.yaml:" >&2; head -n5 pnpm-lock.yaml >&2 || true; fi
        # If explicitly requested by caller, ignore any importer-local lockfile
        if [ "${if ignoreImporterLock then "1" else "0"}" = "1" ]; then
          echo "[BNX-MKNM-DEBUG] ignoreImporterLock=1; removing importer-local lockfile before install" >&2
          rm -f pnpm-lock.yaml >/dev/null 2>&1 || true
        fi
        # If generation is allowed, ignore lockfiles only when one is not already present in src.
        # This prevents "outdated lockfile" mismatches when a temp importer has no lock yet,
        # but still respects a real lockfile when it exists.
        if [ "${if genAllowed then "1" else "0"}" = "1" ] && [ ! -f pnpm-lock.yaml ]; then
          echo "[BNX-MKNM-DEBUG] allow-generate=1 and no lockfile in src; proceeding without an importer lockfile" >&2
        fi
        # Do not rely on pnpm cache from the store output; resolve strictly from lockfile + store
        # Ensure a lockfile is present: prefer using the exported lockfile from pnpm-store
        if [ ! -f pnpm-lock.yaml ]; then
          if [ "${if ignoreImporterLock then "1" else "0"}" != "1" ] && [ -f "${store}/lockfile/pnpm-lock.yaml" ]; then
            echo "[nix] mkNodeModules: using exported lockfile from store"
            cp "${store}/lockfile/pnpm-lock.yaml" pnpm-lock.yaml
          elif [ -f ${if lockInput != null then "${lockInput}" else "/nonexistent"} ]; then
            echo "[nix] mkNodeModules: injecting importer lockfile input"
            cp ${if lockInput != null then "${lockInput}" else "/nonexistent"} pnpm-lock.yaml
          elif [ "${if genAllowed then "1" else "0"}" = "1" ]; then
            echo "[nix] mkNodeModules: offline install to create lockfile (allow-generate)"
          echo "[BNX-MKNM-DEBUG] pnpm install (generate) --offline --no-frozen-lockfile --ignore-scripts --prod=false (FT=${ftVal}s)" >&2
          timeout "$FT"s env PNPM_HOME="$PNPM_HOME" pnpm install --offline --no-frozen-lockfile --ignore-scripts --prod=false --lockfile-dir "." --dir "."
          else
            echo "[nix] mkNodeModules: no lockfile present and generation not allowed; failing"
            exit 3
          fi
        else
          # Install strictly from the fixed-output store for the specific importer (relative to importer root)
          # Force inclusion of devDependencies so tool binaries (e.g., vite) are available
          echo "[BNX-MKNM-DEBUG] pnpm install (offline) --frozen-lockfile --ignore-scripts --prod=false (FT=${ftVal}s)" >&2
          timeout "$FT"s env PNPM_HOME="$PNPM_HOME" pnpm install --offline --frozen-lockfile --ignore-scripts --prod=false --lockfile-dir "." --dir "."
        fi
        echo "[nix] mkNodeModules: install complete"
        echo "[nix] mkNodeModules: listing node_modules/.bin"
        ls -la node_modules/.bin || true
        echo "[nix] mkNodeModules: probing vitest under pnpm virtual store"
        find node_modules/.pnpm -maxdepth 2 -type d -name "vitest@*" -print || true
        find node_modules -maxdepth 4 -type f -name "vitest.mjs" -print || true
        echo "[BNX-MKNM-DEBUG] end mkNodeModules buildPhase" >&2
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
