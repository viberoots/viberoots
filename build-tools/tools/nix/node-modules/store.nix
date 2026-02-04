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
      # Do not use prefetched stores for pnpm-store FODs. They can include extra packages
      # beyond the lockfile, which makes the fixed-output hash unstable.
      preferPrefetch = false;
      prefetchedInput = null;
      ftVal = let v = builtins.getEnv "NIX_PNPM_FETCH_TIMEOUT"; in if v != "" then v else "180";
      # Choose FOD hashing strategy:
      # - When a lockfile is present (in live FS or flake snapshot), fix the output hash to the lockfile hash.
      # - When lockfile is missing and generation is allowed, do NOT fix the output hash (non-FOD) to avoid hash mismatch.
      # - When lockfile is missing and generation is not allowed, keep a placeholder FOD digest to preserve previous behavior.
      genAllowed = (builtins.getEnv "NIX_PNPM_ALLOW_GENERATE") == "1";
      fixHashAttrs =
        if (hasLockFs || hasLockStore) then {
          outputHashMode = "recursive";
          outputHash = outHash;
        } else if genAllowed then {
          # Non-FOD when generation is allowed and no lockfile exists
        } else {
          outputHashMode = "recursive";
          outputHash = placeholderDigest;
        };
    in pkgs.stdenvNoCC.mkDerivation ({
      pname = "pnpm-store";
      version = if (hasLockFs || hasLockStore) then "lock-${builtins.hashFile "sha256" (if hasLockFs then lockAbsStrFs else lockAbsStrStore)}" else "lock-missing";
      inherit src;
      nativeBuildInputs = [ node pnpm pkgs.coreutils ];
      preferLocalBuild = true;
      allowSubstitutes = false;
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
        export SOURCE_DATE_EPOCH=1
        export TZ=UTC
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
        if [ "${if genAllowed then "1" else "0"}" = "1" ] && [ ! -f pnpm-lock.yaml ]; then
          echo "[nix] mkPnpmStore: allow-generate=1 and no lockfile in src; ignoring any provided lockfile input" >&2
          LOCK_INPUT_PATH="/nonexistent"
        fi
        if [ ! -f pnpm-lock.yaml ] && [ -f "$LOCK_INPUT_PATH" ]; then
          echo "[nix] mkPnpmStore: injecting importer lockfile input from $LOCK_INPUT_PATH" >&2
          cp "$LOCK_INPUT_PATH" pnpm-lock.yaml
        fi
        if [ ! -f pnpm-lock.yaml ]; then
          if [ "${if genAllowed then "1" else "0"}" = "1" ]; then
            echo "[nix] mkPnpmStore: no lockfile present but allow-generate=1; producing empty store and continuing" >&2
            mkdir -p "$out/store" "$out/lockfile"
            # Do not attempt any network; leave store empty. Downstream mkNodeModules will generate a lock offline.
            touch "$out/lockfile/pnpm-lock.yaml" || true
            runHook postBuild
            exit 0
          fi
          echo "[nix] mkPnpmStore: no lockfile present; seed a lockfile first using build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${relLock} (set NIX_PNPM_ALLOW_GENERATE=1 for generation)" >&2
          exit 4
        fi
        pnpm config set store-dir "$out/store"
        # Force workspace root to current directory to avoid inheriting repo-root workspace
        printf '%s\n' "packages:" > pnpm-workspace.yaml
        printf '%s\n' "  - ./" >> pnpm-workspace.yaml
        echo "[nix] pnpm install (timeout) --frozen-lockfile --ignore-scripts --prod=false --lockfile-dir . --dir . (FT=${ftVal}s)"
        FT="${ftVal}"
        timeout "$FT"s env PNPM_HOME="$PNPM_HOME" pnpm install --frozen-lockfile --ignore-scripts --prod=false --lockfile-dir "." --dir "."
        echo "[nix] mkPnpmStore: install complete"
        # Normalize store timestamps and scrub volatile JSON fields to stabilize FOD output
        if [ -d "$out/store" ]; then
          echo "[nix] mkPnpmStore: normalizing timestamps in store" >&2
          find "$out/store" -exec touch -h -t 197001010000 {} + >/dev/null 2>&1 || true
          echo "[nix] mkPnpmStore: scrubbing volatile JSON fields" >&2
          OUT_STORE="$out/store" node -e '
            const fs=require("fs"); const path=require("path");
            const root=process.env.OUT_STORE||"";
            function scrub(obj){
              if(!obj||typeof obj!=="object") return;
              delete obj.checkedAt; delete obj.createdAt; delete obj.updatedAt; delete obj.timestamp;
              for (const k of Object.keys(obj)) scrub(obj[k]);
            }
            function walk(d){
              for (const ent of fs.readdirSync(d,{withFileTypes:true})) {
                const p=path.join(d, ent.name);
                if (ent.isDirectory()) walk(p);
                else if (ent.isFile() && ent.name.endsWith(".json")) {
                  try {
                    const txt=fs.readFileSync(p,"utf8");
                    const j=JSON.parse(txt);
                    scrub(j);
                    fs.writeFileSync(p, JSON.stringify(j));
                  } catch {}
                }
              }
            }
            if (root && fs.existsSync(root)) walk(root);
          ' || true
        fi
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
    } // fixHashAttrs);

  mkPnpmStoreUnfixed = { lockfilePath, importerDir, npmrcPath ? null, packageJsonPath ? null }:
    let
      relLock = lockfilePath;
      relLockDir = dirnameOf relLock;
      src = importerOnlySrc { inherit importerDir; lockfilePath = relLock; };
      lockAbsStrStore = "${repoRoot}/${relLock}";
      lockAbsStrFs = "${repoFsRoot}/${relLock}";
      hasLockFs = builtins.pathExists lockAbsStrFs;
      hasLockStore = builtins.pathExists lockAbsStrStore;
      lockInput = if hasLockFs then (builtins.path { path = lockAbsStrFs; name = "pnpm-lock.yaml"; }) else (if hasLockStore then (builtins.path { path = lockAbsStrStore; name = "pnpm-lock.yaml"; }) else null);
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "pnpm-store-unfixed";
      version = if (hasLockFs || hasLockStore) then "lock-${builtins.hashFile "sha256" (if hasLockFs then lockAbsStrFs else lockAbsStrStore)}" else "lock-missing";
      inherit src;
      nativeBuildInputs = [ node pnpm pkgs.coreutils ];
      preferLocalBuild = true;
      allowSubstitutes = false;
      dontPatchShebangs = true;
      unpackPhase = ''
        echo "[nix] mkPnpmStoreUnfixed: unpackPhase begin"
        runHook preUnpack
        cp -r $src source
        chmod -R u+rwX source
        cd source/${importerDir}
        echo "[nix] mkPnpmStoreUnfixed: entered $(pwd)"
        ls -la || true
        runHook postUnpack
        echo "[nix] mkPnpmStoreUnfixed: unpackPhase end"
      '';
      buildPhase = ''
        runHook preBuild
        # quiet: reduce verbose diagnostics
        export SOURCE_DATE_EPOCH=1
        export TZ=UTC
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
        # Inject lockfile if available
        LOCK_INPUT_PATH="${if lockInput != null then "${lockInput}" else "/nonexistent"}"
        echo "[nix] mkPnpmStoreUnfixed: lockInput=${if lockInput != null then "present" else "absent"} path=$LOCK_INPUT_PATH" >&2
        if [ ! -f pnpm-lock.yaml ] && [ -f "$LOCK_INPUT_PATH" ]; then
          echo "[nix] mkPnpmStoreUnfixed: injecting importer lockfile input from $LOCK_INPUT_PATH" >&2
          cp "$LOCK_INPUT_PATH" pnpm-lock.yaml
        fi
        mkdir -p "$out/store" "$out/lockfile"
        if [ ! -f pnpm-lock.yaml ]; then
          if [ "${builtins.getEnv "NIX_PNPM_ALLOW_GENERATE"}" = "1" ]; then
            echo "[nix] mkPnpmStoreUnfixed: no lockfile present but allow-generate=1; producing empty store and continuing" >&2
            touch "$out/lockfile/pnpm-lock.yaml" || true
            runHook postBuild
            exit 0
          fi
          echo "[nix] mkPnpmStoreUnfixed: no lockfile present; seed a lockfile first using build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${relLock} (set NIX_PNPM_ALLOW_GENERATE=1 for generation)" >&2
          exit 4
        fi
        pnpm config set store-dir "$out/store"
        # Force workspace root to current directory to avoid inheriting repo-root workspace
        printf '%s\n' "packages:" > pnpm-workspace.yaml
        printf '%s\n' "  - ./" >> pnpm-workspace.yaml
        echo "[nix] mkPnpmStoreUnfixed: pnpm install --frozen-lockfile --ignore-scripts --prod=false --lockfile-dir . --dir ."
        FT="''${NIX_PNPM_FETCH_TIMEOUT:-180}"
        timeout "$FT"s env PNPM_HOME="$PNPM_HOME" pnpm install --frozen-lockfile --ignore-scripts --prod=false --lockfile-dir "." --dir "."
        echo "[nix] mkPnpmStoreUnfixed: install complete"
        # Normalize store timestamps and scrub volatile JSON fields to stabilize output hashing
        if [ -d "$out/store" ]; then
          echo "[nix] mkPnpmStoreUnfixed: normalizing timestamps in store" >&2
          find "$out/store" -exec touch -h -t 197001010000 {} + >/dev/null 2>&1 || true
          echo "[nix] mkPnpmStoreUnfixed: scrubbing volatile JSON fields" >&2
          OUT_STORE="$out/store" node -e '
            const fs=require("fs"); const path=require("path");
            const root=process.env.OUT_STORE||"";
            function scrub(obj){
              if(!obj||typeof obj!=="object") return;
              delete obj.checkedAt; delete obj.createdAt; delete obj.updatedAt; delete obj.timestamp;
              for (const k of Object.keys(obj)) scrub(obj[k]);
            }
            function walk(d){
              for (const ent of fs.readdirSync(d,{withFileTypes:true})) {
                const p=path.join(d, ent.name);
                if (ent.isDirectory()) walk(p);
                else if (ent.isFile() && ent.name.endsWith(".json")) {
                  try {
                    const txt=fs.readFileSync(p,"utf8");
                    const j=JSON.parse(txt);
                    scrub(j);
                    fs.writeFileSync(p, JSON.stringify(j));
                  } catch {}
                }
              }
            }
            if (root && fs.existsSync(root)) walk(root);
          ' || true
        fi
        # Export lockfile (if present) so downstream consumers can use it without regenerating
        if [ -f pnpm-lock.yaml ]; then
          cp pnpm-lock.yaml "$out/lockfile/pnpm-lock.yaml"
        fi
        runHook postBuild
      '';
    };
}
