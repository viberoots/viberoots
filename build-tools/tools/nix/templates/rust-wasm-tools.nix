{
  pkgs,
  wasmtimePkgs ? pkgs,
  rustToolchain ? pkgs.viberootsRustToolchain,
  rustPlatform ? pkgs.viberootsRustPlatform,
}:
let
  wasmtime = wasmtimePkgs.wasmtime_36;
  buildAdapter = flavor:
    rustPlatform.buildRustPackage {
      pname = "viberoots-wasi-preview1-${flavor}-adapter";
      version = wasmtime.version;
      src = wasmtime.src;
      cargoDeps = wasmtime.cargoDeps;
      dontUseCargoBuildHook = true;
      buildPhase = ''
        runHook preBuild
        ${rustToolchain}/bin/cargo build \
          --offline --release -j "$NIX_BUILD_CORES" \
          -p wasi-preview1-component-adapter \
          --target wasm32-unknown-unknown \
          ${pkgs.lib.optionalString (flavor == "command") "--no-default-features --features command"}
        runHook postBuild
      '';
      doCheck = false;
      installPhase = ''
        install -Dm644 \
          target/wasm32-unknown-unknown/release/wasi_snapshot_preview1.wasm \
          "$out/share/wasi_snapshot_preview1.${flavor}.wasm"
      '';
    };
in {
  browserEngine = pkgs.firefox;
  browserExecutable =
    if pkgs.stdenv.hostPlatform.isDarwin
    then "${pkgs.firefox}/Applications/Firefox.app/Contents/MacOS/firefox"
    else "${pkgs.firefox}/bin/firefox";
  wasmBindgen = pkgs.wasm-bindgen-cli_0_2_100;
  wasmTools = pkgs.wasm-tools;
  wasmOpt = pkgs.binaryen;
  inherit wasmtime;
  adapters = {
    reactor = buildAdapter "reactor";
    command = buildAdapter "command";
  };
}
