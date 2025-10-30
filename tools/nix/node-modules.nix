{ pkgs, repoRoot ? ../../., hashesPath ? ../../tools/nix/node-modules.hashes.json, prefetchedStorePathGlobal ? null }:
let
  lib = pkgs.lib;
  node = pkgs.nodejs_22;
  pnpm = pkgs.pnpm;

  sanitizeName = s:
    (import ./templates-common.nix { inherit pkgs; }).sanitizeName s;

  # Note: Do NOT convert prefetchedStorePathGlobal to a Nix store path at evaluation time.
  # Doing so with builtins.path would copy potentially large directories during eval
  # and can appear as a deadlock. We defer conversion to mkPnpmStore/mkNodeModules.

  # Read mapping of lockfile path (relative) -> sha256 for FODs
  hashMap =
    if builtins.pathExists hashesPath
    then builtins.fromJSON (builtins.readFile hashesPath)
    else {};

  # Valid base64 placeholder digest (will be replaced by update-pnpm-hash.ts on first real build)
  placeholderDigest = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  # Minimal importer-scoped source snapshot (pure): include only importer dir and lockfile
  importerOnlySrc = { importerDir, lockfilePath }:
    pkgs.lib.cleanSourceWith {
      src = repoRoot;
      filter = path: type:
        let
          p = builtins.toString path;
          rel = lib.removePrefix ((builtins.toString repoRoot) + "/") p;
          impPrefix = importerDir + "/";
          lockDir = dirnameOf lockfilePath;
          lockPrefix = if lockDir == "" then "" else (lockDir + "/");
          # Helper: does REL start with prefix S?
          relHasPrefix = s: lib.hasPrefix s rel;
          # Helper: is REL a parent of importerDir? i.e. REL is a prefix of impPrefix
          isParentOfImporter = lib.hasPrefix rel impPrefix;
          # Helper: is REL a parent of lockDir?
          isParentOfLock = lockPrefix != "" && lib.hasPrefix rel lockPrefix;
          # Exclude any vendor artifacts to keep derivations stable and cached
          # - Always ignore paths under importerDir/node_modules and importerDir/.pnpm
          # - When importerDir is the repo root ("."), also ignore top-level node_modules/.pnpm
          isVendorPath =
            (relHasPrefix (impPrefix + "node_modules") || relHasPrefix (impPrefix + ".pnpm")) ||
            (importerDir == "." && (relHasPrefix "node_modules" || relHasPrefix ".pnpm"));
        in
        (
          # Always include parent directories so traversal reaches importerDir/lockDir
          (type == "directory" && (rel == importerDir || relHasPrefix impPrefix || isParentOfImporter || (lockPrefix != "" && (rel == lockDir || relHasPrefix lockPrefix || isParentOfLock))))
          # Include files under importerDir
          || ((type != "directory") && (relHasPrefix impPrefix))
          # Special-case root importer: include top-level package.json so pnpm sees a project
          || (importerDir == "." && type != "directory" && rel == "package.json")
          # Include lockfile and files under its dir; special-case root lockfile
          || ((lockPrefix == "" && type != "directory" && rel == lockfilePath) || (lockPrefix != "" && ((type != "directory" && (rel == lockfilePath || relHasPrefix lockPrefix)))))
          # Top-level files sometimes consulted by pnpm
          || (builtins.match "^pnpm-workspace\\.yaml$" rel != null)
          || (builtins.match "^\\.npmrc$" rel != null)
        ) && (!isVendorPath);
    };

  dirnameOf = p: let parts = lib.splitString "/" p; in lib.concatStringsSep "/" (lib.take (lib.length parts - 1) parts);

  mkPnpmStore = { lockfilePath, importerDir, npmrcPath ? null, packageJsonPath ? null, prefetchedStorePath ? prefetchedStorePathGlobal }:
    let
      relLock = lockfilePath;
      relLockDir = dirnameOf relLock;
      src = importerOnlySrc { inherit importerDir; lockfilePath = relLock; };
      outHash = hashMap.${relLock} or placeholderDigest;
      certs = pkgs.cacert;
      lockAbsStr = "${repoRoot}/${relLock}";
      hasLock = builtins.pathExists lockAbsStr;
      # Prefer an explicit mkPnpmStore argument; fall back to the global arg/env.
      chosenPrefetchedPath = if prefetchedStorePath == null || prefetchedStorePath == "" then prefetchedStorePathGlobal else prefetchedStorePath;
      # Only use a prefetched store when explicitly enabled via env. Default is to fetch inside the FOD
      # to avoid loops caused by partially hydrated local stores.
      preferPrefetch = (builtins.getEnv "NIX_USE_PREFETCHED_PNPM_STORE") == "1";
      # Materialize the chosen path into the Nix store so builders can read it in sandbox.
      prefetchedInput = if (!preferPrefetch) || (chosenPrefetchedPath == null || chosenPrefetchedPath == "") then null else builtins.path { path = chosenPrefetchedPath; name = "prefetched-store"; };
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "pnpm-store";
      version = if hasLock then "lock-${builtins.hashFile "sha256" lockAbsStr}" else "lock-missing";
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
        if [ ! -f pnpm-lock.yaml ]; then
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
        lockHash = if hasLock then builtins.hashFile "sha256" lockAbsStr else "";
        prefetchUsed = prefetchedInput != null;
        chosenPrefetchedPath = if chosenPrefetchedPath == null then "" else chosenPrefetchedPath;
        prefetchedInputPath = if prefetchedInput == null then "" else prefetchedInput;
      };
    };

  mkNodeModules = { lockfilePath, importerDir, npmrcPath ? null, packageJsonPath ? null, prefetchedStorePath ? prefetchedStorePathGlobal }:
    let
      relLock = lockfilePath;
      relLockDir = dirnameOf relLock;
      src = importerOnlySrc { inherit importerDir; lockfilePath = relLock; };
      certs = pkgs.cacert;
      store = mkPnpmStore { inherit lockfilePath importerDir npmrcPath packageJsonPath prefetchedStorePath; };
      lockAbsStr = "${repoRoot}/${relLock}";
      hasLock = builtins.pathExists lockAbsStr;
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "node-modules";
      version = if hasLock then "lock-${builtins.hashFile "sha256" lockAbsStr}" else "lock-missing";
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
            PNPM_HOME="$PNPM_HOME" pnpm install --offline --frozen-lockfile --ignore-scripts --prod=false --lockfile-dir "." --dir "."
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
      passthru.lockHash = if hasLock then builtins.hashFile "sha256" lockAbsStr else "";
    };

  # Backward-compat: default to repo root lockfile if present
  defaultLock = if builtins.pathExists (repoRoot + "/pnpm-lock.yaml") then "pnpm-lock.yaml" else null;
  pnpm-store-default = if defaultLock == null then null else mkPnpmStore {
    lockfilePath = defaultLock;
    importerDir = ".";
  };
  node-modules-default = if defaultLock == null then null else mkNodeModules {
    lockfilePath = defaultLock;
    importerDir = ".";
  };
in {
  inherit mkPnpmStore mkNodeModules sanitizeName;
  # Preserve previous attribute names when root lockfile exists
  pnpm-store = if pnpm-store-default == null then (pkgs.runCommand "pnpm-store-missing" {} "mkdir -p $out; echo no-root-lockfile > $out/info") else pnpm-store-default;
  node-modules = if node-modules-default == null then (pkgs.runCommand "node-modules-missing" {} "mkdir -p $out; echo no-root-lockfile > $out/info") else node-modules-default;
}


