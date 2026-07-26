{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  Contract = import ./rust-contract.nix { inherit lib; };
  validateLockSources = lockFile:
    import ../../../rust/cargo-source-policy.nix { inherit lockFile; };
  validateKindTarget = Contract.validateKindTarget;
in {
  inherit validateKindTarget;
  rustPackage = {
    name,
    kind,
    cargoRoot,
    cargoManifest,
    cargoLock,
    cargoOutputHashes ? {},
    cargoFixedSources ? {},
    crate,
    features ? [],
    defaultFeatures ? true,
    profile ? "release",
    target ? "",
    patchInputs ? [],
    devOverrides ? {},
    nixpkgDeps ? [],
    nativeInputs ? { libraries = []; headers = []; },
    sourcePlan ? { nixpkgs_profile = "default"; nixpkg_pins = {}; },
    sourceComposition ? null,
    crateType ? "rlib",
    publicCrate ? crate,
    hostRole ? "target",
    generatedOutputs ? [],
    }:
    let
      validatedTarget = validateKindTarget kind target;
      _sources = validateLockSources cargoLock;
      compositionRoots = if sourceComposition == null then [ cargoRoot ]
        else map (root: root.cargoRoot) sourceComposition.roots;
      _cargoConfig = Contract.validateCargoConfigs compositionRoots;
      _crateRole = Contract.validateCrateRole crateType hostRole validatedTarget;
      validatedPublicCrate = Contract.validatePublicCrate publicCrate;
      targetName = lib.last (lib.splitString ":" name);
      sanitized = H.sanitizeName name;
      featureFlags = lib.optionals (!defaultFeatures) [ "--no-default-features" ]
        ++ lib.optionals (features != []) [ "--features" (lib.concatStringsSep "," features) ];
      kindFlags = if kind == "bin" || kind == "wasi" then [ "--bin" targetName ] else if kind == "test" then [ "--tests" ] else [ "--lib" ];
      cargoProfile = if profile == "dev" then "debug" else "release";
      targetFlags = lib.optionals (validatedTarget != "") [ "--target" validatedTarget ];
      cargoTarget = if validatedTarget == "" then pkgs.stdenv.targetPlatform.rust.rustcTargetSpec else validatedTarget;
      targetDir = "target/${cargoTarget}/${cargoProfile}";
      artifactDir = if hostRole == "host" then "target/${cargoProfile}" else targetDir;
      dynamicExtension = pkgs.stdenv.hostPlatform.extensions.sharedLibrary;
      targetPkgs =
        if kind == "wasi" then pkgs.pkgsCross.wasi32
        else pkgs;
      rustc = if kind == "wasi" then targetPkgs.buildPackages.rustc else pkgs.rustc;
      nativePackages = nativeInputs.libraries ++ nativeInputs.headers;
      nativeLibraryFlags = map (package: "-Lnative=${package}/lib") nativeInputs.libraries;
      testProfileFlags = lib.optionals (cargoProfile == "release") [ "--release" ];
      testBuildFlags = [
        "--offline"
        "--locked"
        "--no-run"
        "--message-format=json-render-diagnostics"
        "--package"
        crate
      ] ++ kindFlags ++ featureFlags ++ testProfileFlags ++ [ "--target" cargoTarget ];
      testBuildCommand = lib.concatMapStringsSep " " lib.escapeShellArg testBuildFlags;
      vendorPlan = import ./rust-vendor.nix {
        inherit pkgs cargoRoot cargoLock cargoOutputHashes cargoFixedSources sourceComposition;
        cargoRootRel =
          if sourceComposition == null then "."
          else (builtins.head (builtins.filter
            (root: root.label == name)
            sourceComposition.roots)).cargo_root;
      };
      cargoRootRel =
        if sourceComposition == null then "."
        else (builtins.head (builtins.filter
          (root: root.label == name)
          sourceComposition.roots)).cargo_root;
      vendorAuthorities = vendorPlan.vendorAuthorities;
      patchPlan = import ./rust-patches.nix {
        inherit pkgs cargoLock patchInputs vendorAuthorities;
        inherit devOverrides;
      };
      baseInstallPhase = import ./rust-install.nix {
        inherit pkgs lib kind crateType crate targetDir targetName
          artifactDir dynamicExtension;
        publicCrate = validatedPublicCrate;
      };
      compositionEvidence = {
        manifest = if sourceComposition == null then [] else sourceComposition.manifest;
        digest = if sourceComposition == null then
          builtins.hashString "sha256" (builtins.toJSON [])
        else sourceComposition.digest;
      };
      installPhase = baseInstallPhase + ''
        mkdir -p "$out/share/viberoots-rust"
        cat > "$out/share/viberoots-rust/composition.json" <<'VIBEROOTS_RUST_COMPOSITION'
        ${builtins.toJSON compositionEvidence}
        VIBEROOTS_RUST_COMPOSITION
      '';
      _overrideTrace =
        if devOverrides == {} then true
        else builtins.trace
          "[DEV OVERRIDES ACTIVE] Rust fixed sources are explicit local-development bundle inputs."
          true;
    in assert validatedTarget != null; assert _sources; assert _cargoConfig;
    assert _crateRole; assert _overrideTrace;
    pkgs.rustPlatform.buildRustPackage ({
      pname = "rust-${sanitized}";
      version = "0.1.0";
      src = vendorPlan.sourceWithVendor;
      unpackPhase = ''
        runHook preUnpack
        cp -R "$src" source
        chmod -R u+w source
        runHook postUnpack
      '';
      sourceRoot = "source/${cargoRootRel}";
      cargoVendorDir = ".viberoots-cargo-vendor";
      cargoBuildType = cargoProfile;
      cargoBuildFlags = [ "--locked" "--package" crate ] ++ kindFlags ++ featureFlags ++ targetFlags;
      cargoTestFlags = [ "--package" crate ] ++ kindFlags ++ featureFlags ++ targetFlags;
      doCheck = false;
      nativeBuildInputs = [ pkgs.cargo rustc pkgs.pkg-config pkgs.jq pkgs.llvmPackages.lld ]
        ++ nixpkgDeps ++ nativePackages;
      buildInputs = nixpkgDeps ++ nativePackages;
      RUSTC = "${rustc}/bin/rustc";
      RUSTDOC = "${rustc}/bin/rustdoc";
      CARGO = "${pkgs.cargo}/bin/cargo";
      CARGO_NET_OFFLINE = "true";
      RUSTFLAGS = lib.concatStringsSep " " nativeLibraryFlags;
      C_INCLUDE_PATH = lib.makeSearchPath "include" nativePackages;
      LIBRARY_PATH = lib.makeLibraryPath nativeInputs.libraries;
      VIBEROOTS_RUST_LINK_LIBRARY_PATHS = lib.makeLibraryPath nativeInputs.libraries;
      postPatch = ''
        test -f Cargo.toml
        test -f Cargo.lock
        ${lib.concatMapStringsSep "\n" (input: "test -e ${lib.escapeShellArg (builtins.toString input)}") patchInputs}
        ${patchPlan.postPatch}
      '';
      inherit installPhase;
      passthru.viberootsRust = {
        inherit kind crate features profile crateType hostRole generatedOutputs;
        publicCrate = validatedPublicCrate;
        target = validatedTarget;
        default_features = defaultFeatures;
        nixpkgs_profile = sourcePlan.nixpkgs_profile;
        nixpkg_pins = sourcePlan.nixpkg_pins;
        cargo_manifest = builtins.toString cargoManifest;
        cargo_lock = builtins.toString cargoLock;
        cargo_output_hashes = cargoOutputHashes;
        cargo_fixed_sources = cargoFixedSources;
        patch_vendor_authorities = vendorAuthorities;
        native_link_inputs = map builtins.toString nativeInputs.libraries;
        native_header_inputs = map builtins.toString nativeInputs.headers;
        composition = if sourceComposition == null then [] else sourceComposition.diagnostics;
        composition_manifest = if sourceComposition == null then [] else sourceComposition.manifest;
        composition_digest = if sourceComposition == null then
          builtins.hashString "sha256" (builtins.toJSON [])
        else sourceComposition.digest;
        runtime_closure = map builtins.toString nativePackages;
        runtime_packages = nativePackages;
        cargo_packages = map (package: {
          inherit (package) name version;
          source = package.source or "";
        }) ((builtins.fromTOML (builtins.readFile cargoLock)).package or []);
      };
    } // lib.optionalAttrs (kind == "test") {
      postBuild = ''
        cargo metadata --offline --locked --format-version 1 \
          > .viberoots-cargo-metadata.json
        cargo test ${testBuildCommand} > .viberoots-cargo-artifacts.jsonl
      '';
    });
}
