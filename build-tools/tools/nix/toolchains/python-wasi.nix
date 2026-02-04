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
  wasiRuntimeTar = pkgs.fetchurl {
    url = "https://github.com/vmware-labs/webassembly-language-runtimes/releases/download/python/3.12.0%2B20231211-040d5a6/python-3.12.0-wasi-sdk-20.0.tar.gz";
    sha256 = "0kbxnrp6lkkx8pwac64qjvrgbgrr0p3vs1i9xrzfh2dfd6xxs73c";
  };
in
pkgs.stdenvNoCC.mkDerivation {
  pname = "python-wasi-toolchain";
  version = version;
  nativeBuildInputs = [ pkgs.coreutils pkgs.findutils pkgs.gnutar ];
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

    mkdir -p "$out/runtime"
    ${pkgs.gnutar}/bin/tar xf ${wasiRuntimeTar} -C "$out/runtime"
    if [ ! -f "$out/runtime/bin/python-3.12.0.wasm" ]; then
      echo "python-wasi toolchain: runtime wasm missing under $out/runtime/bin" >&2
      exit 2
    fi
    cp "$out/runtime/bin/python-3.12.0.wasm" "$out/runtime/bin/python.wasm"
  '';
  installPhase = "true";
}
