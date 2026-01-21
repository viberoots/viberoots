{ pkgs }:
let
  lib = pkgs.lib;
  hostPython = if pkgs ? python312 then pkgs.python312 else pkgs.python3;
  hostPythonDev = if hostPython ? dev then hostPython.dev else hostPython;
  version = hostPython.version or "unknown";
  parts = lib.splitString "." version;
  major = if builtins.length parts > 0 then lib.elemAt parts 0 else "3";
  minor = if builtins.length parts > 1 then lib.elemAt parts 1 else "12";
  soabi = "cpython-${major}${minor}-wasm32-wasi";
  extSuffix = ".${soabi}.so";
in
pkgs.stdenvNoCC.mkDerivation {
  pname = "python-wasi-toolchain";
  version = version;
  nativeBuildInputs = [ pkgs.coreutils pkgs.findutils ];
  dontUnpack = true;
  buildPhase = ''
    set -euo pipefail
    includeHeader="$(${pkgs.findutils}/bin/find ${hostPythonDev}/include -maxdepth 2 -name "Python.h" -print | head -n1)"
    if [ -z "$includeHeader" ] || [ ! -f "$includeHeader" ]; then
      echo "python-wasi toolchain: Python.h missing under ${hostPythonDev}/include" >&2
      exit 2
    fi
    includeDir="$(dirname "$includeHeader")"

    mkdir -p "$out/config"
    printf "%s" "${extSuffix}" > "$out/config/ext-suffix.txt"
    printf "%s" "${version}" > "$out/config/python-version.txt"
    printf "%s" "$includeDir" > "$out/config/include-dir.txt"

    mkdir -p "$out/include"
    cp -R "$includeDir/." "$out/include/"
  '';
  installPhase = "true";
}
