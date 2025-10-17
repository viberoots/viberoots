{ pkgs, repoRoot ? ../../., hashesPath ? ../../tools/nix/node-modules.hashes.json }:
let
  lib = pkgs.lib;
  node = pkgs.nodejs_22;
  pnpm = pkgs.pnpm;

  sanitizeName = s:
    (import ./templates-common.nix { inherit pkgs; }).sanitizeName s;

  # Read mapping of lockfile path (relative) -> sha256 for FODs
  hashMap =
    if builtins.pathExists hashesPath
    then builtins.fromJSON (builtins.readFile hashesPath)
    else {};

  # Valid base64 placeholder digest (will be replaced by update-pnpm-hash.ts on first real build)
  placeholderDigest = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  # Keep sources minimal and importer-scoped
  cleanSrc = lockfilePath: importerDir: pkgs.lib.cleanSourceWith {
    src = repoRoot;
    filter = path: type:
      let
        p = builtins.toString path;
        rel = lib.removePrefix ((builtins.toString repoRoot) + "/") p;
        pkgRel = if importerDir == "." then "package.json" else (importerDir + "/package.json");
        impPrefix = importerDir + "/";
        lockDir = lib.concatStringsSep "/" (lib.init (lib.splitString "/" lockfilePath));
        lockPrefix = if lockDir == "" then "" else (lockDir + "/");
        isPrefix = s: (lib.hasPrefix s rel);
      in
      # Always keep top-level aggregator dirs to allow walking into importers
      (type == "directory" && (rel == "apps" || rel == "libs"))
      # Keep directories that are prefixes of the importer dir or lockfile dir so children survive
      || (type == "directory" && ((importerDir != "." && (rel == importerDir || isPrefix impPrefix)) || (lockPrefix != "" && (rel == lockDir || isPrefix lockPrefix))))
      # Include all files under the importer dir and lockfile dir
      || ((type != "directory") && (importerDir != "." && isPrefix impPrefix))
      || ((type != "directory") && (lockPrefix != "" && isPrefix lockPrefix))
      || (builtins.match ("^" + (lib.escapeRegex lockfilePath) + "$") rel != null)
      || (builtins.match ("^" + (lib.escapeRegex pkgRel) + "$") rel != null)
      || (builtins.match "^pnpm-workspace\\.yaml$" rel != null)
      || (builtins.match "^\\.npmrc$" rel != null)
      || (builtins.match "^patches/pnpm(/.*)?$" rel != null);
  };

  dirnameOf = p: let parts = lib.splitString "/" p; in lib.concatStringsSep "/" (lib.take (lib.length parts - 1) parts);

  mkPnpmStore = { lockfilePath, importerDir, npmrcPath ? null, packageJsonPath ? null }:
    let
      relLock = lockfilePath;
      relLockDir = dirnameOf relLock;
      src = cleanSrc relLock importerDir;
      outHash = hashMap.${relLock} or placeholderDigest;
      certs = pkgs.cacert;
      lockAbs = builtins.toPath "${repoRoot}/${relLock}";
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "pnpm-store";
      version = "lock-${builtins.hashFile "sha256" lockAbs}";
      inherit src;
      nativeBuildInputs = [ node pnpm ];
      outputHashMode = "recursive";
      outputHash = outHash;
      dontPatchShebangs = true;
      unpackPhase = ''
        runHook preUnpack
        cp -r $src source
        chmod -R u+rwX source
        cd source
        runHook postUnpack
      '';
      buildPhase = ''
        runHook preBuild
        export SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
        export NIX_SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
        export NODE_EXTRA_CA_CERTS=${certs}/etc/ssl/certs/ca-bundle.crt
        export HOME=$(pwd)/.home
        mkdir -p "$HOME"
        export COREPACK_ENABLE=0
        export PNPM_HOME="$HOME/.pnpm-home"
        mkdir -p "$PNPM_HOME"
        # Strip packageManager to prevent corepack/pnpm self-bootstrap
        node -e 'const fs=require("fs"); const p="${importerDir}/package.json"; if(fs.existsSync(p)){const j=JSON.parse(fs.readFileSync(p,"utf8")); delete j.packageManager; fs.writeFileSync(p, JSON.stringify(j, null, 2));}'
        pnpm config set store-dir "$out/store"
        PNPM_HOME="$PNPM_HOME" pnpm fetch --frozen-lockfile --lockfile-dir "${relLockDir}" --dir "${importerDir}"
        runHook postBuild
      '';
      passthru.lockHash = builtins.hashFile "sha256" lockAbs;
    };

  mkNodeModules = { lockfilePath, importerDir, npmrcPath ? null, packageJsonPath ? null }:
    let
      relLock = lockfilePath;
      relLockDir = dirnameOf relLock;
      src = cleanSrc relLock importerDir;
      certs = pkgs.cacert;
      store = mkPnpmStore { inherit lockfilePath importerDir npmrcPath packageJsonPath; };
      lockAbs = builtins.toPath "${repoRoot}/${relLock}";
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "node-modules";
      version = "lock-${builtins.hashFile "sha256" lockAbs}";
      inherit src;
      nativeBuildInputs = [ node pnpm ];
      unpackPhase = ''
        runHook preUnpack
        cp -r $src source
        chmod -R u+rwX source
        cd source
        runHook postUnpack
      '';
      buildPhase = ''
        runHook preBuild
        export SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
        export NIX_SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
        export NODE_EXTRA_CA_CERTS=${certs}/etc/ssl/certs/ca-bundle.crt
        export HOME=$(pwd)/.home
        mkdir -p "$HOME"
        export COREPACK_ENABLE=0
        export PNPM_HOME="$HOME/.pnpm-home"
        mkdir -p "$PNPM_HOME"
        # Strip packageManager to prevent corepack/pnpm self-bootstrap loops inside hermetic builds
        node -e 'const fs=require("fs"); const p="${importerDir}/package.json"; if(fs.existsSync(p)){const j=JSON.parse(fs.readFileSync(p,"utf8")); delete j.packageManager; fs.writeFileSync(p, JSON.stringify(j, null, 2));}'
        pnpm config set store-dir "${store}/store"
        # Install strictly from the fixed-output store for the specific importer
        PNPM_HOME="$PNPM_HOME" pnpm install --offline --frozen-lockfile --ignore-scripts --lockfile-dir "${relLockDir}" --dir "${importerDir}"
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
      passthru.lockHash = builtins.hashFile "sha256" lockAbs;
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


