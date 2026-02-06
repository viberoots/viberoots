{ pkgs }:
let
  toolchain = name: pkg:
    pkgs.symlinkJoin {
      name = name;
      paths = [ pkg ];
    };
in
{
  go = toolchain "toolchain-go" pkgs.go;
  python = toolchain "toolchain-python" pkgs.python3;
}
