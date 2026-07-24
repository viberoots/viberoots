{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  validateLockSources = lockFile:
    import ../../../rust/cargo-source-policy.nix { inherit lockFile; };
in {
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
    sourcePlan ? { nixpkgs_profile = "default"; nixpkg_pins = {}; },
  }:
    let
      _sources = validateLockSources cargoLock;
      cargoConfigs = [
        (cargoRoot + "/.cargo/config")
        (cargoRoot + "/.cargo/config.toml")
      ];
      presentCargoConfigs = builtins.filter builtins.pathExists cargoConfigs;
      _cargoConfig = if presentCargoConfigs == [] then true else
        builtins.throw "Rust Cargo configuration is unsupported because it can replace dependency sources: ${builtins.toString (builtins.head presentCargoConfigs)}";
      targetName = lib.last (lib.splitString ":" name);
      sanitized = H.sanitizeName name;
      featureFlags = lib.optionals (!defaultFeatures) [ "--no-default-features" ]
        ++ lib.optionals (features != []) [ "--features" (lib.concatStringsSep "," features) ];
      kindFlags = if kind == "bin" then [ "--bin" targetName ] else if kind == "test" then [ "--tests" ] else [ "--lib" ];
      cargoProfile = if profile == "dev" then "debug" else "release";
      targetFlags = lib.optionals (target != "") [ "--target" target ];
      cargoTarget = if target == "" then pkgs.stdenv.targetPlatform.rust.rustcTargetSpec else target;
      targetDir = "target/${cargoTarget}/${cargoProfile}";
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
        inherit pkgs cargoRoot cargoLock cargoOutputHashes cargoFixedSources;
      };
      vendorAuthorities = vendorPlan.vendorAuthorities;
      patchPlan = import ./rust-patches.nix {
        inherit pkgs cargoLock patchInputs vendorAuthorities;
        inherit devOverrides;
      };
      _overrideTrace =
        if devOverrides == {} then true
        else builtins.trace
          "[DEV OVERRIDES ACTIVE] Rust fixed sources are explicit local-development bundle inputs."
          true;
    in assert _sources; assert _cargoConfig; assert _overrideTrace;
    pkgs.rustPlatform.buildRustPackage ({
      pname = "rust-${sanitized}";
      version = "0.1.0";
      src = vendorPlan.sourceWithVendor;
      cargoVendorDir = ".viberoots-cargo-vendor";
      cargoBuildType = cargoProfile;
      cargoBuildFlags = [ "--locked" "--package" crate ] ++ kindFlags ++ featureFlags ++ targetFlags;
      cargoTestFlags = [ "--package" crate ] ++ kindFlags ++ featureFlags ++ targetFlags;
      doCheck = false;
      nativeBuildInputs = [ pkgs.cargo pkgs.rustc pkgs.pkg-config pkgs.jq ]
        ++ nixpkgDeps;
      buildInputs = nixpkgDeps;
      RUSTC = "${pkgs.rustc}/bin/rustc";
      RUSTDOC = "${pkgs.rustc}/bin/rustdoc";
      CARGO = "${pkgs.cargo}/bin/cargo";
      RUSTFLAGS = "";
      postPatch = ''
        test -f ${lib.escapeShellArg (builtins.toString cargoManifest)}
        test -f ${lib.escapeShellArg (builtins.toString cargoLock)}
        ${lib.concatMapStringsSep "\n" (input: "test -e ${lib.escapeShellArg (builtins.toString input)}") patchInputs}
        ${patchPlan.postPatch}
      '';
      installPhase = if kind == "bin" then ''
        runHook preInstall
        install -Dm755 "${targetDir}/${targetName}" "$out/bin/${targetName}"
        runHook postInstall
      '' else if kind == "test" then ''
        runHook preInstall
        mkdir -p "$out/bin" "$out/libexec/rust-tests"
        package_id="$(${pkgs.jq}/bin/jq -er --arg crate ${lib.escapeShellArg crate} '
          [.packages[] | select(.name == $crate) | .id]
          | if length == 1 then .[0] else error("expected exactly one requested Cargo package") end
        ' .viberoots-cargo-metadata.json)"
        ${pkgs.jq}/bin/jq -r --arg package_id "$package_id" '
          select(
            .reason == "compiler-artifact"
            and .package_id == $package_id
            and .profile.test == true
            and .executable != null
          )
          | .executable
        ' .viberoots-cargo-artifacts.jsonl > .viberoots-test-harnesses
        if [ ! -s .viberoots-test-harnesses ]; then
          echo "rust test ${crate}: Cargo produced no executable test harness" >&2
          exit 2
        fi
        while IFS= read -r candidate; do
          if [ ! -f "$candidate" ] || [ ! -x "$candidate" ]; then
            echo "rust test ${crate}: Cargo reported an unavailable test harness: $candidate" >&2
            exit 2
          fi
          destination="$out/libexec/rust-tests/$(basename "$candidate")"
          if [ -e "$destination" ]; then
            echo "rust test ${crate}: Cargo reported colliding test harness names: $(basename "$candidate")" >&2
            exit 2
          fi
          install -Dm755 "$candidate" "$destination"
        done < .viberoots-test-harnesses
        cat > "$out/bin/${targetName}" <<'EOF'
        #!${pkgs.runtimeShell}
        set -eu
        for test_binary in "$(dirname "$0")/../libexec/rust-tests/"*; do
          "$test_binary" "$@"
        done
        EOF
        chmod +x "$out/bin/${targetName}"
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
        nixpkgs_profile = sourcePlan.nixpkgs_profile;
        nixpkg_pins = sourcePlan.nixpkg_pins;
        cargo_manifest = builtins.toString cargoManifest;
        cargo_lock = builtins.toString cargoLock;
        cargo_output_hashes = cargoOutputHashes;
        cargo_fixed_sources = cargoFixedSources;
        patch_vendor_authorities = vendorAuthorities;
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
