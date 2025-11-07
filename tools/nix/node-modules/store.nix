{ pkgs, repoRoot, repoFsRoot, hashesPath, prefetchedStorePathGlobal ? null }:
let
  common = import ./common.nix { inherit pkgs repoRoot repoFsRoot hashesPath prefetchedStorePathGlobal; };
  lib = common.lib;
  node = pkgs.nodejs_22;
  pnpm = pkgs.pnpm;
  certs = pkgs.cacert;
  dirnameOf = common.dirnameOf;
  importerOnlySrc = common.importerOnlySrc;
  hashMap = common.hashMap;
  placeholderDigest = common.placeholderDigest;
  inherit repoRoot repoFsRoot prefetchedStorePathGlobal;
in {
  mkPnpmStore = { lockfilePath, importerDir, npmrcPath ? null, packageJsonPath ? null, prefetchedStorePath ? prefetchedStorePathGlobal }:
    let
      relLock = lockfilePath;
      relLockDir = dirnameOf relLock;
      src = importerOnlySrc { inherit importerDir; lockfilePath = relLock; };
      outHash = hashMap.${relLock} or placeholderDigest;
      lockAbsStrStore = "${repoRoot}/${relLock}";
      lockAbsStrFs = "${repoFsRoot}/${relLock}";
      hasLockFs = builtins.pathExists lockAbsStrFs;
      hasLockStore = builtins.pathExists lockAbsStrStore;
      lockInput = if hasLockFs then (builtins.path { path = lockAbsStrFs; name = "pnpm-lock.yaml"; }) else (if hasLockStore then (builtins.path { path = lockAbsStrStore; name = "pnpm-lock.yaml"; }) else null);
      # Prefer an explicit mkPnpmStore argument; fall back to the global arg/env.
      chosenPrefetchedPath = if prefetchedStorePath == null || prefetchedStorePath == "" then prefetchedStorePathGlobal else prefetchedStorePath;
      # Only use a prefetched store when explicitly enabled via env. Default is to fetch inside the FOD
      # to avoid loops caused by partially hydrated local stores.
      preferPrefetch = (builtins.getEnv "NIX_USE_PREFETCHED_PNPM_STORE") == "1";
      # Materialize the chosen path into the Nix store so builders can read it in sandbox.
      prefetchedInput = if (!preferPrefetch) || (chosenPrefetchedPath == null || chosenPrefetchedPath == "") then null else builtins.path { path = chosenPrefetchedPath; name = "prefetched-store"; };
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "pnpm-store";
      version = if (hasLockFs || hasLockStore) then "lock-${builtins.hashFile "sha256" (if hasLockFs then lockAbsStrFs else lockAbsStrStore)}" else "lock-missing";
      inherit src;
      nativeBuildInputs = [ node pnpm pkgs.coreutils ];
      preferLocalBuild = true;
      allowSubstitutes = false;
      outputHashMode = "recursive";
      outputHash = outHash;
      dontPatchShebangs = true;
      unpackPhase = ''
        echo "[nix] mkPnpmStore: unpackPhase begin"
        runHook preUnpack
        cp -r $src source
        chmod -R u+rwX source
        cd source/${importerDir}
        echo "[nix] mkPnpmStore: entered $(pwd)"
        ls -la || true
        runHook postUnpack
        echo "[nix] mkPnpmStore: unpackPhase end"
      '';
      buildPhase = if (prefetchedInput == null) then ''
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
        # Strip packageManager to prevent corepack/pnpm self-bootstrap (relative to importer root)
        node -e 'const fs=require("fs"); const p="package.json"; if(fs.existsSync(p)){const j=JSON.parse(fs.readFileSync(p,"utf8")); delete j.packageManager; fs.writeFileSync(p, JSON.stringify(j, null, 2));}'
        # Do NOT generate a lockfile inside this fixed-output derivation. This must be seeded
        # outside the FOD to avoid non-deterministic outputs across runs.
        LOCK_INPUT_PATH="${if lockInput != null then "${lockInput}" else "/nonexistent"}"
        echo "[nix] mkPnpmStore: lockInput=${if lockInput != null then "present" else "absent"} path=$LOCK_INPUT_PATH" >&2
        if [ ! -f pnpm-lock.yaml ] && [ -f "$LOCK_INPUT_PATH" ]; then
          echo "[nix] mkPnpmStore: injecting importer lockfile input from $LOCK_INPUT_PATH" >&2
          cp "$LOCK_INPUT_PATH" pnpm-lock.yaml
        fi
        if [ ! -f pnpm-lock.yaml ]; then
          if [ "${builtins.getEnv "NIX_PNPM_ALLOW_GENERATE"}" = "1" ]; then
            echo "[nix] mkPnpmStore: no lockfile present but allow-generate=1; producing empty store and continuing" >&2
            mkdir -p "$out/store" "$out/lockfile"
            # Do not attempt any network; leave store empty. Downstream mkNodeModules will generate a lock offline.
            touch "$out/lockfile/pnpm-lock.yaml" || true
            runHook postBuild
            exit 0
          fi
          echo "[nix] mkPnpmStore: no lockfile present; seed a lockfile first using tools/dev/update-pnpm-hash.ts --lockfile ${relLock} (set NIX_PNPM_ALLOW_GENERATE=1 for generation)" >&2
          exit 4
        fi
        pnpm config set store-dir "$out/store"
        echo "[nix] pnpm install (timeout) --frozen-lockfile --ignore-scripts --prod=false --lockfile-dir . --dir ."
        # Allow override via env; increase default to reduce flaky partial stores in CI/temp repos
        FT="''${NIX_PNPM_FETCH_TIMEOUT:-180}"
        timeout "$FT"s env PNPM_HOME="$PNPM_HOME" pnpm install --frozen-lockfile --ignore-scripts --prod=false --lockfile-dir "." --dir "."
        echo "[nix] mkPnpmStore: install complete"
        # Export lockfile (if present) so downstream consumers can use it without regenerating
        mkdir -p "$out/lockfile"
        if [ -f pnpm-lock.yaml ]; then
          cp pnpm-lock.yaml "$out/lockfile/pnpm-lock.yaml"
        fi
        runHook postBuild
      '' else ''
        runHook preBuild
        # quiet: reduce verbose diagnostics
        mkdir -p "$out/store"
        # Copying avoids embedding references to the prefetched store path in a FOD output
        cp -R ${prefetchedInput}/. "$out/store/"
        echo "[nix] mkPnpmStore: sample of copied store layout"
        (cd "$out/store" && find . -maxdepth 2 -type d | sort | head -n 200) || true
        runHook postBuild
      '';
      passthru = {
        lockHash = if (hasLockFs || hasLockStore) then builtins.hashFile "sha256" (if hasLockFs then lockAbsStrFs else lockAbsStrStore) else "";
        prefetchUsed = prefetchedInput != null;
        chosenPrefetchedPath = if chosenPrefetchedPath == null then "" else chosenPrefetchedPath;
        prefetchedInputPath = if prefetchedInput == null then "" else prefetchedInput;
      };
    };
}
