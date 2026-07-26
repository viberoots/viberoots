{ pkgs }:
let
  toolchain = name: packages:
    pkgs.symlinkJoin {
      name = name;
      paths = if builtins.isList packages then packages else [ packages ];
    };
  rustTargetClosure = pkgs.runCommand "toolchain-rust-target-components" {
    nativeBuildInputs = [
      pkgs.rustc
      pkgs.pkgsCross.wasi32.buildPackages.rustc
    ];
  } ''
    set -eu
    mkdir -p "$out/nix-support"
    raw_target="$(${pkgs.rustc}/bin/rustc --print target-libdir --target wasm32-unknown-unknown)"
    wasi_target="$(${pkgs.pkgsCross.wasi32.buildPackages.rustc}/bin/rustc --print target-libdir --target wasm32-wasip1)"
    test -d "$raw_target"
    test -d "$wasi_target"
    printf '%s\n%s\n' "$raw_target" "$wasi_target" > "$out/nix-support/rust-target-libdirs"
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
    pkgs.cargo
    pkgs.rustc
    pkgs.rustfmt
    pkgs.clippy
    pkgs.llvmPackages.lld
    # Keep both reviewed target component closures in the exported toolchain
    # rather than relying on a worker's ambient Rust setup.
    pkgs.pkgsCross.wasi32.buildPackages.rustc
    rustTargetClosure
  ];
  opentofu = toolchain "toolchain-opentofu" pkgs.opentofu;
}
