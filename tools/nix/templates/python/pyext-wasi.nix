{ pkgs }:
args:
let
  lib = pkgs.lib;
  H = import ../../lib/lang-helpers.nix { inherit pkgs; };
  crossPkgs = pkgs.pkgsCross.wasi32;

  name = args.name or "pyext-wasi-unnamed";
  module = args.module or "";
  srcRoot = args.srcRoot or ../../..;
  subdir = args.subdir or ".";
  srcList0 = args.srcList or [];
  cflags0 = args.cflags or [];
  ldflags0 = args.ldflags or [];
  wheelhouse0 = args.wheelhouse or null;
  buildPyDeps0 = args.buildPyDeps or [];

  ensureStringList = ctx: xs:
    if xs == null then []
    else if builtins.isList xs && builtins.all builtins.isString xs then xs
    else builtins.throw ("pyExtWasi: expected " + ctx + " to be a list of strings");

  srcList = ensureStringList "srcList" srcList0;
  cflags = ensureStringList "cflags" cflags0;
  ldflags = ensureStringList "ldflags" ldflags0;
  buildPyDeps = ensureStringList "buildPyDeps" buildPyDeps0;

  wheelhouse =
    if wheelhouse0 == null then null
    else if builtins.isAttrs wheelhouse0 then wheelhouse0
    else builtins.throw "pyExtWasi: expected wheelhouse to be a derivation/attrset (or null)";

  _moduleRequired =
    if module == "" then builtins.throw ("pyExtWasi: module is required for " + name) else null;

  pkgSrc = builtins.path {
    path = builtins.toPath ("${builtins.toString srcRoot}/${subdir}");
    name = "pyext-wasi-src";
  };

  isC = p: lib.hasSuffix ".c" p;
  isCxx = p: lib.hasSuffix ".cc" p || lib.hasSuffix ".cpp" p || lib.hasSuffix ".cxx" p;
  compileSrcs = builtins.filter (p: isC p || isCxx p) srcList;
  sortedCompileSrcs = lib.sort (a: b: a < b) compileSrcs;
  wantCxx = builtins.any isCxx compileSrcs;

  py = pkgs.python3;

  moduleRel = lib.replaceStrings [ "." ] [ "/" ] module;
in
crossPkgs.stdenv.mkDerivation {
  pname = "pyext-wasi-${H.sanitizeName name}";
  version = "0.1.0";
  src = pkgSrc;

  nativeBuildInputs = [ pkgs.coreutils py ] ++ (if wheelhouse == null then [] else [ wheelhouse ]);
  passthru =
    (if wheelhouse == null then {}
     else {
       wheelhouse = wheelhouse;
       wheelhouseEnv = wheelhouse.passthru.uv2nixEnv or null;
     });

  dontConfigure = true;
  dontInstallCheck = true;

  buildPhase = ''
    set -euo pipefail

    unset NIX_CFLAGS_COMPILE || true
    unset NIX_CFLAGS_LINK || true
    unset NIX_LDFLAGS || true

    if [ ${toString (builtins.length sortedCompileSrcs)} -eq 0 ]; then
      echo "pyExtWasi: no compilable sources in srcList for ${name}" >&2
      exit 2
    fi

    EXT_SUFFIX="$(${py}/bin/python -c 'import sysconfig; print(sysconfig.get_config_var("EXT_SUFFIX") or "")')"
    if [ -z "$EXT_SUFFIX" ]; then
      echo "pyExtWasi: failed to determine EXT_SUFFIX from ${py}/bin/python" >&2
      exit 2
    fi
    INCLUDEPY="$(${py}/bin/python -c 'import sysconfig; print(sysconfig.get_config_var("INCLUDEPY") or "")')"
    if [ -z "$INCLUDEPY" ]; then
      echo "pyExtWasi: failed to determine INCLUDEPY from ${py}/bin/python" >&2
      exit 2
    fi

    PYCONFIG_DIR="$PWD/build/pyconfig"
    mkdir -p "$PYCONFIG_DIR"
    cat > "$PYCONFIG_DIR/pyconfig.h" <<'PYCFG'
#pragma once
#include_next <pyconfig.h>
#undef SIZEOF_LONG
#define SIZEOF_LONG 4
#undef SIZEOF_VOID_P
#define SIZEOF_VOID_P 4
#undef SIZEOF_SIZE_T
#define SIZEOF_SIZE_T 4
#undef SIZEOF_TIME_T
#define SIZEOF_TIME_T 8
PYCFG
    cat > "$PYCONFIG_DIR/Python.h" <<'PYTHONH'
#pragma once
#include "pyconfig.h"
#define Py_PYCONFIG_H
#include_next <Python.h>
PYTHONH

    WHEELHOUSE_SITE="${if wheelhouse == null then "" else "${wheelhouse}/site"}"
    EXTRA_PY_INC=""
    if [ -n "$WHEELHOUSE_SITE" ] && [ ${toString (builtins.length buildPyDeps)} -gt 0 ]; then
      export PYTHONPATH="$WHEELHOUSE_SITE"
      export PYTHONNOUSERSITE=1
      for pkg in ${lib.concatStringsSep " " (map lib.escapeShellArg buildPyDeps)}; do
        inc="$(${py}/bin/python - "$pkg" <<'PY'
import importlib
import os
import sys

pkg = sys.argv[1]
try:
    m = importlib.import_module(pkg)
except Exception as e:
    raise SystemExit(f"pyExtWasi: build_py_deps includes '{pkg}' but it is not importable from wheelhouse (check uv.lock): {e}")

get_inc = getattr(m, "get_include", None)
if callable(get_inc):
    p = str(get_inc())
    if not p:
        raise SystemExit(f"pyExtWasi: {pkg}.get_include() returned empty")
    print(p)
    raise SystemExit(0)

mod_file = getattr(m, "__file__", None)
if not mod_file:
    raise SystemExit(f"pyExtWasi: cannot determine include dir for '{pkg}' (no __file__ and no get_include())")

base = os.path.dirname(os.path.abspath(mod_file))
cand = os.path.join(base, "include")
if os.path.isdir(cand):
    print(cand)
    raise SystemExit(0)

raise SystemExit(
    f"pyExtWasi: cannot determine include dir for '{pkg}'. "
    f"Expected {pkg}.get_include() or a directory at {cand}"
)
PY
)"
        EXTRA_PY_INC="$EXTRA_PY_INC -I$inc"
      done
    fi

    mkdir -p build/obj
    objs=""

    for rel in ${lib.concatStringsSep " " (map lib.escapeShellArg sortedCompileSrcs)}; do
      srcPath="$PWD/$rel"
      base="$(basename "$rel")"
      obj="build/obj/$base.o"
      mkdir -p "$(dirname "$obj")"
      case "$srcPath" in
        *.c)
        $CC -O2 -fPIC -I"$PYCONFIG_DIR" -I"$INCLUDEPY" $EXTRA_PY_INC ${lib.concatStringsSep " " (map lib.escapeShellArg cflags)} -c "$srcPath" -o "$obj"
          ;;
        *.cpp|*.cc|*.cxx)
        $CXX -O2 -fPIC -I"$PYCONFIG_DIR" -I"$INCLUDEPY" $EXTRA_PY_INC ${lib.concatStringsSep " " (map lib.escapeShellArg cflags)} -c "$srcPath" -o "$obj"
          ;;
      esac
      objs="$objs $obj"
    done

    outRel="${moduleRel}''${EXT_SUFFIX}"
    outDir="$(dirname "$outRel")"
    mkdir -p "build/site/$outDir"

    $CC -Wl,--no-entry -Wl,--export-all -Wl,--allow-undefined ${lib.concatStringsSep " " (map lib.escapeShellArg ldflags)} $objs -o "build/site/$outRel"
  '';

  installPhase = ''
    set -euo pipefail
    mkdir -p "$out/site"
    cp -R build/site/. "$out/site/"
  '';
}
