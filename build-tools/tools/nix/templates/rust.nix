{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  supportedRegistry = "registry+https://github.com/rust-lang/crates.io-index";
  sourceLines = lockFile:
    builtins.filter (line: lib.hasPrefix "source = \"" line)
      (lib.splitString "\n" (builtins.readFile lockFile));
  validateLockSources = lockFile:
    let unsupported = builtins.filter (line: line != "source = \"${supportedRegistry}\"") (sourceLines lockFile);
    in if unsupported == [] then true else
      builtins.throw "Rust Cargo.lock contains unsupported dependency source: ${builtins.head unsupported}";
in {
  rustPackage = {
    name,
    kind,
    cargoRoot,
    cargoManifest,
    cargoLock,
    crate,
    features ? [],
    defaultFeatures ? true,
    profile ? "release",
    target ? "",
    patchInputs ? [],
  }:
    let
      _sources = validateLockSources cargoLock;
      targetName = lib.last (lib.splitString ":" name);
      sanitized = H.sanitizeName name;
      featureFlags = lib.optionals (!defaultFeatures) [ "--no-default-features" ]
        ++ lib.optionals (features != []) [ "--features" (lib.concatStringsSep "," features) ];
      kindFlags = if kind == "bin" then [ "--bin" targetName ] else [ "--lib" ];
      cargoProfile = if profile == "dev" then "debug" else "release";
      targetFlags = lib.optionals (target != "") [ "--target" target ];
      cargoTarget = if target == "" then pkgs.stdenv.targetPlatform.rust.rustcTargetSpec else target;
      targetDir = "target/${cargoTarget}/${cargoProfile}";
    in assert _sources; pkgs.rustPlatform.buildRustPackage {
      pname = "rust-${sanitized}";
      version = "0.1.0";
      src = cargoRoot;
      cargoLock.lockFile = cargoLock;
      cargoBuildType = cargoProfile;
      cargoBuildFlags = [ "--locked" "--package" crate ] ++ kindFlags ++ featureFlags ++ targetFlags;
      cargoTestFlags = [];
      doCheck = false;
      nativeBuildInputs = [ pkgs.cargo pkgs.rustc ];
      RUSTC = "${pkgs.rustc}/bin/rustc";
      RUSTDOC = "${pkgs.rustc}/bin/rustdoc";
      CARGO = "${pkgs.cargo}/bin/cargo";
      RUSTFLAGS = "";
      postPatch = ''
        test -f ${lib.escapeShellArg (builtins.toString cargoManifest)}
        test -f ${lib.escapeShellArg (builtins.toString cargoLock)}
        ${lib.concatMapStringsSep "\n" (input: "test -e ${lib.escapeShellArg (builtins.toString input)}") patchInputs}
      '';
      installPhase = if kind == "bin" then ''
        runHook preInstall
        install -Dm755 "${targetDir}/${targetName}" "$out/bin/${targetName}"
        runHook postInstall
      '' else ''
        runHook preInstall
        shopt -s nullglob
        candidates=("${targetDir}/deps/lib${lib.replaceStrings ["-"] ["_"] crate}-"*.rlib)
        if [ "''${#candidates[@]}" -ne 1 ]; then
          echo "rust library ${crate}: expected exactly one compiled rlib, found ''${#candidates[@]}" >&2
          exit 2
        fi
        install -Dm644 "''${candidates[0]}" "$out/lib/lib${crate}.rlib"
        runHook postInstall
      '';
      passthru.viberootsRust = {
        inherit kind crate features profile target;
        default_features = defaultFeatures;
        cargo_manifest = builtins.toString cargoManifest;
        cargo_lock = builtins.toString cargoLock;
      };
    };
}
