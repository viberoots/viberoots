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
    outputHash = "sha256-nSySfpEzhcuYkYb9q2wFWFWbU1Zvr0yuGgg4OpEu6cc=";
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
      pnpm config set store-dir "${pnpm-store}/store"
      pnpm install --offline --frozen-lockfile
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


