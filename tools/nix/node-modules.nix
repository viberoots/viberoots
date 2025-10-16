{ pkgs, repoRoot ? ../../. }:
let
  node = pkgs.nodejs_22;
  pnpm = pkgs.pnpm;
  storeSrc = pkgs.lib.cleanSourceWith {
    # Use repository root so lockfile and package.json are visible
    src = repoRoot;
    filter = path: type:
      (builtins.match ".*/pnpm-lock\\.yaml" path != null)
      || (builtins.match ".*/package\\.json" path != null)
      || (builtins.match ".*/pnpm-workspace\\.yaml" path != null)
      || (builtins.match ".*/\\.npmrc" path != null)
      || (builtins.match ".*/patches/pnpm(/.*)?" path != null);
  };
  minimalSrc = storeSrc;
  lockPath = "${repoRoot}/pnpm-lock.yaml";
  pnpm-store = pkgs.stdenvNoCC.mkDerivation (let certs = pkgs.cacert; in {
    pname = "pnpm-store";
    version = "lock-${builtins.hashFile "sha256" lockPath}";
    src = storeSrc;
    nativeBuildInputs = [ node pnpm ];
    outputHashMode = "recursive";
    # Intentionally placeholder to force one-time hash refresh via tools/dev/update-pnpm-hash.ts
    # The update script will rebuild and rewrite this to the correct value.
    outputHash = "sha256-2pniT9SS5dV19DCIdd/fEt7JcClUbUF5QyAFso3JoGY=";
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
      node -e 'const fs=require("fs"); const p="package.json"; if(fs.existsSync(p)){const j=JSON.parse(fs.readFileSync(p,"utf8")); delete j.packageManager; fs.writeFileSync(p, JSON.stringify(j, null, 2));}'
      pnpm config set store-dir "$out/store"
      pnpm fetch --frozen-lockfile
      runHook postBuild
    '';
    passthru.lockHash = builtins.hashFile "sha256" lockPath;
  });
  node-modules = pkgs.stdenvNoCC.mkDerivation (let certs = pkgs.cacert; in {
    pname = "node-modules";
    version = "lock-${builtins.hashFile "sha256" lockPath}";
    src = minimalSrc;
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
      node -e 'const fs=require("fs"); const p="package.json"; if(fs.existsSync(p)){const j=JSON.parse(fs.readFileSync(p,"utf8")); delete j.packageManager; fs.writeFileSync(p, JSON.stringify(j, null, 2));}'
      # Use the read-only fixed-output store in the nix store
      pnpm config set store-dir "${pnpm-store}/store"
      # Disable lifecycle scripts to avoid spawning many node processes and ensure hermeticity
      pnpm install --offline --frozen-lockfile --ignore-scripts
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
    passthru.lockHash = builtins.hashFile "sha256" lockPath;
  });
in { inherit pnpm-store node-modules; }


