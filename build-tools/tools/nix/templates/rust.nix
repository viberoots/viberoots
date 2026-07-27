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
    module ? "",
    buildPyDeps ? [],
    pythonWheelhouse ? null,
    runtimePackages ? [],
    addonName ? "",
    nodeApiVersion ? 0,
    platform ? "",
    pythonAbi ? "", artifactNixRoot ? "",
    }:
    let
      validatedTarget = validateKindTarget kind target;
      _sources = validateLockSources cargoLock;
      compositionRoots = if sourceComposition == null then [ cargoRoot ]
        else map (root: root.cargoRoot) sourceComposition.roots;
      _cargoConfig = Contract.validateCargoConfigs compositionRoots;
      _crateRole = Contract.validateCrateRole crateType hostRole validatedTarget;
      _extension = Contract.validateExtension {
        inherit kind module buildPyDeps addonName nodeApiVersion platform pythonAbi;
        selectedPythonAbi =
          "cp${lib.versions.major pkgs.python3.pythonVersion}${lib.versions.minor pkgs.python3.pythonVersion}";
        selectedNodeApiVersion = 10;
        system = pkgs.stdenv.hostPlatform.system;
      };
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
      baseInstallPhase = if builtins.elem kind [ "pyext" "addon" ] then
        import ./rust-extension-install.nix {
          inherit pkgs lib kind crate module addonName targetDir dynamicExtension;
        }
      else import ./rust-install.nix {
        inherit pkgs lib kind crateType crate targetDir targetName
          artifactDir dynamicExtension;
        publicCrate = validatedPublicCrate;
      };
      extensionRuntime = import ./rust-extension-runtime.nix { inherit pkgs lib kind;
        runtimePackages = if builtins.elem kind [ "pyext" "addon" ] then runtimePackages else []; };
      _pythonAuthority =
        if buildPyDeps != [] && pythonWheelhouse == null then builtins.throw
          "Rust Python extension build_py_deps require an importer-scoped uv.lock wheelhouse"
        else true;
      extensionPackages = runtimePackages
        ++ lib.optionals (kind == "pyext") ([ pkgs.python3 ]
          ++ lib.optional (pythonWheelhouse != null) pythonWheelhouse)
        ++ lib.optionals (kind == "addon") [ pkgs.nodejs_22 ];
      extensionRustFlags = lib.optionals
        (pkgs.stdenv.isDarwin && builtins.elem kind [ "pyext" "addon" ])
        [ "-C" "link-arg=-undefined" "-C" "link-arg=dynamic_lookup" ];
      nodeApiContract = import ./rust-node-api.nix {
        inherit pkgs lib kind nodeApiVersion targetDir crate dynamicExtension; };
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
        cat > "$out/share/viberoots-rust/materialization-manifest.json" <<VIBEROOTS_RUST_MATERIALIZATION
        ${builtins.toJSON {
          schemaVersion = "viberoots.nix-store-materialization.v1";
          sourceRevision = compositionEvidence.digest;
          sourceSnapshot = builtins.toString cargoRoot;
          flakeLockFingerprint = sourcePlan.nixpkgs_profile;
          substituter = {
            endpointIdentity = "https://cache.home.kilty.io/main";
            trustedPublicKeys = [ "main:N7uIAritMCBWpa9cdZJxHJ7gWfsXCwAsbyIJqrSQnLY=" ];
          };
          tools = { nix = if artifactNixRoot == "" then builtins.toString pkgs.nix else artifactNixRoot; };
          storePaths = [{
            attr = H.sanitizeName name;
            path = "__VIBEROOTS_RUST_OUT__";
            expectedOutputIdentity = "__VIBEROOTS_RUST_IDENTITY__";
          }];
        }}
        VIBEROOTS_RUST_MATERIALIZATION
        substituteInPlace "$out/share/viberoots-rust/materialization-manifest.json" \
          --replace-fail "__VIBEROOTS_RUST_OUT__" "$out" \
          --replace-fail "__VIBEROOTS_RUST_IDENTITY__" "$(basename "$out")"
        ${extensionRuntime}
      '';
      _overrideTrace =
        if devOverrides == {} then true
        else builtins.trace
          "[DEV OVERRIDES ACTIVE] Rust fixed sources are explicit local-development bundle inputs."
          true;
    in assert validatedTarget != null; assert _sources; assert _cargoConfig;
    assert _crateRole; assert _extension; assert _pythonAuthority; assert _overrideTrace;
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
        ++ nixpkgDeps ++ nativePackages ++ extensionPackages;
      buildInputs = nixpkgDeps ++ nativePackages ++ extensionPackages;
      RUSTC = "${rustc}/bin/rustc";
      RUSTDOC = "${rustc}/bin/rustdoc";
      CARGO = "${pkgs.cargo}/bin/cargo";
      CARGO_NET_OFFLINE = "true";
      RUSTFLAGS = lib.concatStringsSep " " (nativeLibraryFlags ++ extensionRustFlags);
      PYO3_PYTHON = if kind == "pyext" then "${pkgs.python3}/bin/python" else "";
      NAPI_VERSION = if kind == "addon" then builtins.toString nodeApiVersion else "";
      BINDGEN_EXTRA_CLANG_ARGS = nodeApiContract.bindgenArgs;
      PYTHONPATH = if kind == "pyext" && pythonWheelhouse != null
        then "${pythonWheelhouse}/site"
        else "";
      C_INCLUDE_PATH = lib.concatStringsSep ":" (nodeApiContract.includePaths
        ++ lib.optional (nativePackages != []) (lib.makeSearchPath "include" nativePackages));
      LIBRARY_PATH = lib.makeLibraryPath nativeInputs.libraries;
      VIBEROOTS_RUST_LINK_LIBRARY_PATHS = lib.makeLibraryPath nativeInputs.libraries;
      postPatch = ''
        test -f Cargo.toml
        test -f Cargo.lock
        ${lib.concatMapStringsSep "\n" (input: "test -e ${lib.escapeShellArg (builtins.toString input)}") patchInputs}
        ${patchPlan.postPatch}
      '';
      preBuild = lib.optionalString (kind == "pyext" && buildPyDeps != []) ''
        export PYTHONNOUSERSITE=1
        for package in ${lib.concatStringsSep " " (map lib.escapeShellArg buildPyDeps)}; do
          ${pkgs.python3}/bin/python -c 'import importlib, sys; importlib.import_module(sys.argv[1])' "$package" ||
            { echo "Rust Python extension build_py_deps package $package is not importable from the selected uv.lock wheelhouse" >&2; exit 2; }
        done
      '' + nodeApiContract.preBuild;
      postBuild = nodeApiContract.postBuild;
      inherit installPhase;
      passthru.viberootsRust = {
        inherit kind crate features profile crateType hostRole generatedOutputs;
        inherit module buildPyDeps addonName nodeApiVersion platform pythonAbi pythonWheelhouse;
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
          builtins.hashString "sha256" (builtins.toJSON []) else sourceComposition.digest;
        runtime_closure = map builtins.toString runtimePackages;
        runtime_packages = runtimePackages;
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
