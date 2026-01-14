{ pkgs }:
args:
let
  lib = pkgs.lib;
  H = import ../../lib/lang-helpers.nix { inherit pkgs; };
  C = import ../cpp-common.nix { inherit pkgs; };

  name = args.name or "pyext-unnamed";
  module = args.module or "";
  srcRoot = args.srcRoot or ../../..;
  subdir = args.subdir or ".";
  srcList0 = args.srcList or [];
  cflags0 = args.cflags or [];
  ldflags0 = args.ldflags or [];
  nixCxxAttrs0 = args.nixCxxAttrs or [];

  ensureStringList = ctx: xs:
    if xs == null then []
    else if builtins.isList xs && builtins.all builtins.isString xs then xs
    else builtins.throw ("pyExt: expected " + ctx + " to be a list of strings");

  srcList = ensureStringList "srcList" srcList0;
  cflags = ensureStringList "cflags" cflags0;
  ldflags = ensureStringList "ldflags" ldflags0;
  nixCxxAttrs = ensureStringList "nixCxxAttrs" nixCxxAttrs0;

  _moduleRequired =
    if module == "" then builtins.throw ("pyExt: module is required for " + name) else null;

  pkgSrc = builtins.path {
    path = builtins.toPath ("${builtins.toString srcRoot}/${subdir}");
    name = "pyext-src";
  };

  isC = p: lib.hasSuffix ".c" p;
  isCxx = p: lib.hasSuffix ".cc" p || lib.hasSuffix ".cpp" p || lib.hasSuffix ".cxx" p;
  compileSrcs = builtins.filter (p: isC p || isCxx p) srcList;
  sortedCompileSrcs = lib.sort (a: b: a < b) compileSrcs;
  wantCxx = builtins.any isCxx compileSrcs;

  nixPkgs = C.resolveAttrsToPkgs nixCxxAttrs;
  nixInc = C.nixIncFlags nixPkgs;
  nixLib = C.nixLibFlags nixPkgs;

  py = pkgs.python3;
  compiler = if wantCxx then "${pkgs.llvmPackages.clang}/bin/clang++" else "${pkgs.llvmPackages.clang}/bin/clang";

  moduleRel = lib.replaceStrings [ "." ] [ "/" ] module;
in
pkgs.stdenv.mkDerivation {
  pname = "pyext-${H.sanitizeName name}";
  version = "0.1.0";
  src = pkgSrc;

  buildInputs = nixPkgs ++ [ py ];
  nativeBuildInputs = [ pkgs.llvmPackages.clang pkgs.coreutils ];

  dontConfigure = true;
  dontInstallCheck = true;

  buildPhase = ''
    set -euo pipefail

    if [ ${toString (builtins.length sortedCompileSrcs)} -eq 0 ]; then
      echo "pyExt: no compilable sources in srcList for ${name}" >&2
      exit 2
    fi

    EXT_SUFFIX="$(${py}/bin/python -c 'import sysconfig; print(sysconfig.get_config_var("EXT_SUFFIX") or "")')"
    if [ -z "$EXT_SUFFIX" ]; then
      echo "pyExt: failed to determine EXT_SUFFIX from ${py}/bin/python" >&2
      exit 2
    fi
    INCLUDEPY="$(${py}/bin/python -c 'import sysconfig; print(sysconfig.get_config_var("INCLUDEPY") or "")')"
    if [ -z "$INCLUDEPY" ]; then
      echo "pyExt: failed to determine INCLUDEPY from ${py}/bin/python" >&2
      exit 2
    fi

    mkdir -p build/obj
    objs=""

    for rel in ${lib.concatStringsSep " " (map lib.escapeShellArg sortedCompileSrcs)}; do
      srcPath="$PWD/$rel"
      base="$(basename "$rel")"
      obj="build/obj/$base.o"
      mkdir -p "$(dirname "$obj")"
      ${compiler} -fPIC ${nixInc} -I"$INCLUDEPY" ${lib.concatStringsSep " " (map lib.escapeShellArg cflags)} -c "$srcPath" -o "$obj"
      objs="$objs $obj"
    done

    outRel="${moduleRel}''${EXT_SUFFIX}"
    outDir="$(dirname "$outRel")"
    mkdir -p "build/site/$outDir"

    if [ "${if pkgs.stdenv.isDarwin then "1" else "0"}" = "1" ]; then
      ${compiler} -bundle -undefined dynamic_lookup ${nixLib} ${lib.concatStringsSep " " (map lib.escapeShellArg ldflags)} $objs -o "build/site/$outRel"
    else
      ${compiler} -shared ${nixLib} ${lib.concatStringsSep " " (map lib.escapeShellArg ldflags)} $objs -o "build/site/$outRel"
    fi
  '';

  installPhase = ''
    set -euo pipefail
    mkdir -p "$out/site"
    cp -R build/site/. "$out/site/"
  '';
}


