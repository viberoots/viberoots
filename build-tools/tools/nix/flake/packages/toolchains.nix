{ pkgs }:
let
  toolchain = name: packages:
    pkgs.symlinkJoin {
      name = name;
      paths = if builtins.isList packages then packages else [ packages ];
    };
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
  ];
  opentofu = toolchain "toolchain-opentofu" pkgs.opentofu;
}
