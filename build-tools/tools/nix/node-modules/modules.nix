{ pkgs, repoRoot, repoFsRoot, hashesPath, prefetchedStorePathGlobal ? null, allowLiveHashMap ? true }:
let
  common = import ./common.nix { inherit pkgs repoRoot repoFsRoot hashesPath prefetchedStorePathGlobal allowLiveHashMap; };
  store = import ./store.nix { inherit pkgs repoRoot repoFsRoot hashesPath prefetchedStorePathGlobal allowLiveHashMap; };
  lib = common.lib;
  node = pkgs.nodejs_22;
  pnpm = import ../pnpm-11.nix { inherit pkgs; };
  certs = pkgs.cacert;
  dirnameOf = common.dirnameOf;
  importerOnlySrc = common.importerOnlySrc;
  mkPnpmStore = store.mkPnpmStore;
  supportedPlatforms = import ./supported-platforms.nix { };
  pnpmSupportedArchitectures = supportedPlatforms.markerForSystem pkgs.stdenvNoCC.hostPlatform.system;
  pnpmWorkspaceMarkerScript = ''
    write_pnpm_workspace_marker() {
      local existing="$TMPDIR/pnpm-workspace.source.yaml"
      local workspace_config=""
      local search_dir="$PWD"
      while [ -n "$search_dir" ] && [ "$search_dir" != "/" ]; do
        if [ -f "$search_dir/pnpm-workspace.yaml" ]; then
          workspace_config="$search_dir/pnpm-workspace.yaml"
          break
        fi
        search_dir="$(dirname "$search_dir")"
      done
      if [ -n "$workspace_config" ]; then
        cp "$workspace_config" "$existing"
      else
        : > "$existing"
      fi
      node - "$existing" <<'NODE' > pnpm-workspace.yaml
const fs = require("fs");
const input = process.argv[2];
const lines = fs.existsSync(input) ? fs.readFileSync(input, "utf8").split(/\r?\n/) : [];
const out = ["packages:", "  - ./"];
const skipKeys = new Set(["packages", "supportedArchitectures"]);
for (let i = 0; i < lines.length;) {
  const line = lines[i];
  if (line.trim() === "" || line.trimStart().startsWith("#")) {
    i += 1;
    continue;
  }
  const match = line.match(/^([A-Za-z0-9_.-]+):(?:\s|$)/);
  if (!match) {
    i += 1;
    continue;
  }
  const key = match[1];
  const start = i;
  i += 1;
  while (i < lines.length && !/^[A-Za-z0-9_.-]+:(?:\s|$)/.test(lines[i])) {
    i += 1;
  }
  if (!skipKeys.has(key)) {
    out.push(...lines.slice(start, i));
  }
}
process.stdout.write(out.join("\n") + "\n");
NODE
      printf '%s\n' ${lib.escapeShellArg pnpmSupportedArchitectures} >> pnpm-workspace.yaml
    }
  '';
  inherit repoRoot repoFsRoot prefetchedStorePathGlobal;
in {
  mkNodeModules = { lockfilePath, importerDir, npmrcPath ? null, packageJsonPath ? null, prefetchedStorePath ? prefetchedStorePathGlobal }:
    let
      relLock = lockfilePath;
      relLockDir = dirnameOf relLock;
      src = importerOnlySrc { inherit importerDir; lockfilePath = relLock; };
      store = mkPnpmStore { inherit lockfilePath importerDir npmrcPath packageJsonPath prefetchedStorePath; };
      # Prefer an explicit mkNodeModules argument; fall back to the global arg/env.
      chosenPrefetchedPath = if prefetchedStorePath == null || prefetchedStorePath == "" then prefetchedStorePathGlobal else prefetchedStorePath;
      hasImporterLock = hasLockFs || hasLockStore;
      # Locked installs should be satisfied by the importer-specific fixed pnpm store.
      # Pulling the shared prefetched store into evaluation for that path both slows every
      # build down and makes unrelated dangling entries in the shared cache break otherwise
      # self-contained derivations.
      useSharedPrefetchedStore = !hasImporterLock;
      # Materialize the chosen path into the Nix store only for generation/offline-seeding paths.
      prefetchedInput =
        if useSharedPrefetchedStore && !(chosenPrefetchedPath == null || chosenPrefetchedPath == "")
        then builtins.path { path = chosenPrefetchedPath; name = "prefetched-store"; }
        else null;
      lockAbsStrStore = "${repoRoot}/${relLock}";
      lockAbsStrFs = "${repoFsRoot}/${relLock}";
      hasLockFs = builtins.pathExists lockAbsStrFs;
      hasLockStore = builtins.pathExists lockAbsStrStore;
      lockInput = if hasLockFs then (builtins.path { path = lockAbsStrFs; name = "pnpm-lock.yaml"; }) else (if hasLockStore then (builtins.path { path = lockAbsStrStore; name = "pnpm-lock.yaml"; }) else null);
      ftVal = let v = builtins.getEnv "NIX_PNPM_FETCH_TIMEOUT"; in if v != "" then v else "600";
      installTimeoutVal = let v = builtins.getEnv "NIX_PNPM_INSTALL_TIMEOUT"; in if v != "" then v else "1800";
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "node-modules";
      version = if (hasLockFs || hasLockStore) then "lock-${builtins.hashFile "sha256" (if hasLockFs then lockAbsStrFs else lockAbsStrStore)}" else "lock-missing";
      inherit src;
      nativeBuildInputs = [ node pnpm pkgs.coreutils pkgs.findutils ]
        ++ lib.optionals pkgs.stdenvNoCC.hostPlatform.isLinux [ pkgs.patchelf ];
      # node_modules is a dependency tree assembled from the fixed pnpm store, not a
      # runtime executable output. Avoid generic fixup scans across multi-GB package trees.
      dontFixup = true;
      dontPatchShebangs = true;
      # Darwin builders can carry foreign ELF payloads for reproducibility, but they
      # cannot patch them because patchelf is Linux-only.
      dontPatchELF = !pkgs.stdenvNoCC.hostPlatform.isLinux;
      preferLocalBuild = true;
      allowSubstitutes = false;
      unpackPhase = ''
        runHook preUnpack
        cp -r $src source
        chmod -R u+rwX source
        if [ "''${VBR_MKNM_DEBUG:-0}" = "1" ]; then
          echo "[nix] mkNodeModules: tree under filtered src (max depth 3)"
          (cd source && find . -maxdepth 3 -type d -print | sort)
        fi
        # Ensure we run inside the importer directory so pnpm sees package.json
        cd source/${importerDir}
        echo "[nix] mkNodeModules: entered $(pwd)"
        if [ "''${VBR_MKNM_DEBUG:-0}" = "1" ]; then
          ls -la
        fi
        runHook postUnpack
      '';
      buildPhase = ''
        runHook preBuild
        # quiet: reduce verbose diagnostics
        export SOURCE_DATE_EPOCH=1
        export TZ=UTC
        debug_mknm() {
          if [ "''${VBR_MKNM_DEBUG:-0}" = "1" ]; then
            echo "$@" >&2
          fi
        }
        debug_mknm "[VBR-MKNM-DEBUG] env PATH=$PATH"
        debug_mknm "[VBR-MKNM-DEBUG] node=$(command -v node || echo none) pnpm=$(command -v pnpm || echo none)"
        debug_mknm "[VBR-MKNM-DEBUG] NODE_VERSION=$(node -v 2>/dev/null || echo none) PNPM_VERSION=$(pnpm -v 2>/dev/null || echo none)"
        if ! command -v timeout >/dev/null 2>&1; then
          echo "[VBR-MKNM-ERROR] 'timeout' not found in PATH; coreutils must provide it in builder env" >&2
          echo "[VBR-MKNM-ERROR] PATH=$PATH" >&2
          exit 127
        fi
        debug_mknm "[VBR-MKNM-DEBUG] TIMEOUT_BIN=timeout"
        debug_mknm "[VBR-MKNM-DEBUG] begin mkNodeModules buildPhase (importerDir=${importerDir})"
        debug_mknm "[VBR-MKNM-DEBUG] CWD=$(pwd)"
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
        # For locked installs, seed directly from the importer-specific fixed store so
        # the shared prefetched cache stays off the hot evaluation path.
        # For generation paths, seed from the shared prefetched store when available.
        debug_mknm "[VBR-MKNM-DEBUG] preparing local pnpm store"
        LOCAL_STORE="$HOME/.pnpm-store"
        mkdir -p "$LOCAL_STORE"
        PNPM_BIN="${pnpm}/bin/pnpm"
        PNPM_TRUST_LOCKFILE_ARG=""
        if "$PNPM_BIN" install --help 2>/dev/null | grep -q -- "--trust-lockfile"; then
          PNPM_TRUST_LOCKFILE_ARG="--trust-lockfile"
        fi

        seed_store() {
          src="$1"
          [ -d "$src" ] || return 0
          for verDir in "$src"/v*; do
            [ -d "$verDir" ] || continue
            ver="$(basename "$verDir")"
            mkdir -p "$LOCAL_STORE/$ver"
            chmod -R u+rwX "$LOCAL_STORE/$ver"
            if [ -d "$verDir/files" ]; then
              mkdir -p "$LOCAL_STORE/$ver/files"
              cp -R --no-preserve=ownership "$verDir/files/." "$LOCAL_STORE/$ver/files/"
            fi
            if [ -d "$verDir/index" ]; then
              mkdir -p "$LOCAL_STORE/$ver/index"
              cp -R --no-preserve=mode,ownership "$verDir/index/." "$LOCAL_STORE/$ver/index/"
              chmod -R u+rwX "$LOCAL_STORE/$ver/index"
            fi
            if [ -f "$verDir/index.db" ]; then
              cp --no-preserve=mode,ownership "$verDir/index.db" "$LOCAL_STORE/$ver/index.db"
              chmod u+rw "$LOCAL_STORE/$ver/index.db"
            fi
            if [ -d "$verDir/projects" ]; then
              mkdir -p "$LOCAL_STORE/$ver/projects"
              cp -R --no-preserve=mode,ownership "$verDir/projects/." "$LOCAL_STORE/$ver/projects/"
              chmod -R u+rwX "$LOCAL_STORE/$ver/projects"
            fi
          done
        }

        # Seed the shared prefetched store only for generation paths; locked installs rely
        # on the importer-specific fixed store below.
        if [ -d ${if prefetchedInput != null then "\"${prefetchedInput}\"" else "\"/nonexistent\""} ]; then
          seed_store ${if prefetchedInput != null then "\"${prefetchedInput}\"" else "\"/nonexistent\""}
        fi
        seed_store "${store}/store"
        "$PNPM_BIN" config set store-dir "$LOCAL_STORE"
        # Keep imported package files writable in sandbox builds.
        # Hardlinked files from read-only store paths can fail during bin chmod.
        "$PNPM_BIN" config set package-import-method copy
        ${pnpmWorkspaceMarkerScript}
        write_pnpm_workspace_marker ${lib.escapeShellArg pnpmSupportedArchitectures}
        FT="${ftVal}"
        IT="${installTimeoutVal}"
        debug_mknm "[VBR-MKNM-DEBUG] NIX_PNPM_FETCH_TIMEOUT=$FT"
        debug_mknm "[VBR-MKNM-DEBUG] NIX_PNPM_INSTALL_TIMEOUT=$IT"
        debug_mknm "[VBR-MKNM-DEBUG] lockfile_present=$(test -f pnpm-lock.yaml && echo yes || echo no)"
        if [ "''${VBR_MKNM_DEBUG:-0}" = "1" ] && [ -f pnpm-lock.yaml ]; then
          echo "[VBR-MKNM-DEBUG] head -n5 pnpm-lock.yaml:" >&2
          head -n5 pnpm-lock.yaml >&2 || true
        fi
        # Do not rely on pnpm cache from the store output; resolve strictly from lockfile + store
        # Ensure a lockfile is present: prefer using the exported lockfile from pnpm-store
        if [ ! -f pnpm-lock.yaml ]; then
          if [ -f "${store}/lockfile/pnpm-lock.yaml" ]; then
            echo "[nix] mkNodeModules: using exported lockfile from store"
            cp "${store}/lockfile/pnpm-lock.yaml" pnpm-lock.yaml
          elif [ -f ${if lockInput != null then "${lockInput}" else "/nonexistent"} ]; then
            echo "[nix] mkNodeModules: injecting importer lockfile input"
            cp ${if lockInput != null then "${lockInput}" else "/nonexistent"} pnpm-lock.yaml
          else
            echo "[nix] mkNodeModules: no lockfile present." >&2
            echo "repair: run u" >&2
            exit 3
          fi
        else
          # Install strictly from the fixed-output store for the specific importer (relative to importer root)
          # Force inclusion of devDependencies so tool binaries (e.g., vite) are available
          debug_mknm "[VBR-MKNM-DEBUG] pnpm install (offline) --force --frozen-lockfile --ignore-scripts --prod=false (IT=${installTimeoutVal}s)"
          set +e
          pnpm_log="$TMPDIR/pnpm-install-offline.log"
          timeout "$IT"s env CI="1" NODE_OPTIONS="--no-warnings" PNPM_HOME="$PNPM_HOME" "$PNPM_BIN" install --offline --force --frozen-lockfile --ignore-scripts --ignore-pnpmfile --prod=false --reporter=append-only --lockfile-dir "." --dir "." $PNPM_TRUST_LOCKFILE_ARG >"$pnpm_log" 2>&1
          status="$?"
          set -e
          if [ "$status" -ne 0 ]; then
            echo "[nix] mkNodeModules: pnpm install (offline) failed with status $status" >&2
            cat "$pnpm_log" >&2 || true
            exit "$status"
          fi
        fi
        echo "[nix] mkNodeModules: install complete"
        if [ "''${VBR_MKNM_DEBUG:-0}" = "1" ]; then
          echo "[nix] mkNodeModules: listing node_modules/.bin"
          ls -la node_modules/.bin || true
          echo "[nix] mkNodeModules: probing vitest under pnpm virtual store"
          find node_modules/.pnpm -maxdepth 2 -type d -name "vitest@*" -print || true
          find node_modules -maxdepth 4 -type f -name "vitest.mjs" -print || true
        fi
        debug_mknm "[VBR-MKNM-DEBUG] end mkNodeModules buildPhase"
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
        brokenLinks="$(find "$out" -type l ! -exec test -e {} \; -print || true)"
        if [ -n "$brokenLinks" ]; then
          echo "[nix] mkNodeModules: pruning dangling symlinks before fixup"
          printf '%s\n' "$brokenLinks"
          find "$out" -type l ! -exec test -e {} \; -delete
        fi
        runHook postInstall
      '';
      passthru.lockHash = if (hasLockFs || hasLockStore) then builtins.hashFile "sha256" (if hasLockFs then lockAbsStrFs else lockAbsStrStore) else "";
    };
}
