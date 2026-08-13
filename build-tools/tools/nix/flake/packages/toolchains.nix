{ pkgs, wasmtimePkgs ? pkgs }:
let
  rustWasmTools = import ../../templates/rust-wasm-tools.nix {
    inherit pkgs wasmtimePkgs;
    rustToolchain = pkgs.viberootsRustToolchain;
    rustPlatform = pkgs.viberootsRustPlatform;
  };
  toolchain = name: packages:
    pkgs.symlinkJoin {
      name = name;
      paths = if builtins.isList packages then packages else [ packages ];
    };
  rustTargetClosure = pkgs.runCommand "toolchain-rust-target-components" {
    nativeBuildInputs = [ pkgs.viberootsRustToolchain ];
  } ''
    set -eu
    mkdir -p "$out/nix-support"
    test "$(${pkgs.viberootsRustToolchain}/bin/rustc --version)" = "rustc 1.88.0 (6b00bc388 2025-06-23)"
    raw_target="$(${pkgs.viberootsRustToolchain}/bin/rustc --print target-libdir --target wasm32-unknown-unknown)"
    wasi_target="$(${pkgs.viberootsRustToolchain}/bin/rustc --print target-libdir --target wasm32-wasip1)"
    emscripten_target="$(${pkgs.viberootsRustToolchain}/bin/rustc --print target-libdir --target wasm32-unknown-emscripten)"
    test -d "$raw_target"
    test -d "$wasi_target"
    test -d "$emscripten_target"
    printf '%s\n%s\n%s\n' "$raw_target" "$wasi_target" "$emscripten_target" > "$out/nix-support/rust-target-libdirs"
  '';
in
{
  go = toolchain "toolchain-go" pkgs.go;
  cxx = toolchain "toolchain-cxx" [
    pkgs.llvmPackages.clang
    pkgs.llvmPackages.llvm
  ];
  emscripten = toolchain "toolchain-emscripten" pkgs.emscripten;
  tinygo = toolchain "toolchain-tinygo" [
    pkgs.tinygo
    pkgs.llvmPackages.clang
    pkgs.llvmPackages.lld
  ];
  python = toolchain "toolchain-python" pkgs.python3;
  rust = toolchain "toolchain-rust" [
    pkgs.viberootsRustDeveloperTools
    pkgs.llvmPackages.lld
    # Keep both reviewed target component closures in the exported toolchain
    # rather than relying on a worker's ambient Rust setup.
    rustTargetClosure
    rustWasmTools.wasmBindgen
    rustWasmTools.wasmTools
    rustWasmTools.wasmOpt
    rustWasmTools.wasmtime
    rustWasmTools.adapters.reactor
    rustWasmTools.adapters.command
    pkgs.emscripten
  ];
  opentofu = toolchain "toolchain-opentofu" pkgs.opentofu;
}
