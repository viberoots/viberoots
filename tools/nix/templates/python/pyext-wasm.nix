{ pkgs }:
args:
let
  lib = pkgs.lib;
  H = import ../../lib/lang-helpers.nix { inherit pkgs; };
  Pyodide = import ../../toolchains/pyodide.nix { inherit pkgs; };

  name = args.name or "pyext-wasm-unnamed";
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
    else builtins.throw ("pyExtWasm: expected " + ctx + " to be a list of strings");

  srcList = ensureStringList "srcList" srcList0;
  cflags = ensureStringList "cflags" cflags0;
  ldflags = ensureStringList "ldflags" ldflags0;
  buildPyDeps = ensureStringList "buildPyDeps" buildPyDeps0;

  wheelhouse =
    if wheelhouse0 == null then null
    else if builtins.isAttrs wheelhouse0 then wheelhouse0
    else builtins.throw "pyExtWasm: expected wheelhouse to be a derivation/attrset (or null)";

  _moduleRequired =
    if module == "" then builtins.throw ("pyExtWasm: module is required for " + name) else null;

  pkgSrc = builtins.path {
    path = builtins.toPath ("${builtins.toString srcRoot}/${subdir}");
    name = "pyext-wasm-src";
  };

  isC = p: lib.hasSuffix ".c" p;
  isCxx = p: lib.hasSuffix ".cc" p || lib.hasSuffix ".cpp" p || lib.hasSuffix ".cxx" p;
  compileSrcs = builtins.filter (p: isC p || isCxx p) srcList;
  sortedCompileSrcs = lib.sort (a: b: a < b) compileSrcs;
  py = pkgs.python3;
  emcc = "${pkgs.emscripten}/bin/emcc";
  empp = "${pkgs.emscripten}/bin/em++";

  moduleRel = lib.replaceStrings [ "." ] [ "/" ] module;
in
pkgs.stdenv.mkDerivation {
  pname = "pyext-wasm-${H.sanitizeName name}";
  version = "0.1.0";
  src = pkgSrc;

  nativeBuildInputs = [ pkgs.emscripten pkgs.coreutils pkgs.which ];
  buildInputs = [ py ] ++ (if wheelhouse == null then [] else [ wheelhouse ]);
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

    if [ ${toString (builtins.length sortedCompileSrcs)} -eq 0 ]; then
      echo "pyExtWasm: no compilable sources in srcList for ${name}" >&2
      exit 2
    fi

    EXT_SUFFIX="$(cat ${Pyodide}/config/ext-suffix.txt)"
    if [ -z "$EXT_SUFFIX" ]; then
      echo "pyExtWasm: EXT_SUFFIX missing from pyodide toolchain" >&2
      exit 2
    fi
    PYODIDE_INCLUDE="${Pyodide}/include"
    if [ ! -d "$PYODIDE_INCLUDE" ]; then
      echo "pyExtWasm: pyodide include dir missing at $PYODIDE_INCLUDE" >&2
      exit 2
    fi

    PYODIDE_DEFINES="$(${py}/bin/python - <<'PY'
import importlib.util
import os

cfg = "${Pyodide}/config/sysconfigdata.py"
spec = importlib.util.spec_from_file_location("pyodide_sysconfig", cfg)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
vars = getattr(mod, "build_time_vars", {})

keys = ["SIZEOF_VOID_P", "SIZEOF_WCHAR_T", "HAVE_PTHREAD_H", "HAVE_PTHREAD_STUBS"]
defs = []
for key in keys:
    if key not in vars:
        continue
    val = vars[key]
    if isinstance(val, bool):
        val = 1 if val else 0
    if isinstance(val, int):
        defs.append(f"-D{key}={val}")
    elif isinstance(val, str):
        defs.append(f"-D{key}=\\\"{val}\\\"")
print(" ".join(defs))
PY
)"

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
    raise SystemExit(f"pyExtWasm: build_py_deps includes '{pkg}' but it is not importable from wheelhouse (check uv.lock): {e}")

get_inc = getattr(m, "get_include", None)
if callable(get_inc):
    p = str(get_inc())
    if not p:
        raise SystemExit(f"pyExtWasm: {pkg}.get_include() returned empty")
    print(p)
    raise SystemExit(0)

mod_file = getattr(m, "__file__", None)
if not mod_file:
    raise SystemExit(f"pyExtWasm: cannot determine include dir for '{pkg}' (no __file__ and no get_include())")

base = os.path.dirname(os.path.abspath(mod_file))
cand = os.path.join(base, "include")
if os.path.isdir(cand):
    print(cand)
    raise SystemExit(0)

raise SystemExit(
    f"pyExtWasm: cannot determine include dir for '{pkg}'. "
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
        ${emcc} -O2 -fPIC -I"$PYODIDE_INCLUDE" $PYODIDE_DEFINES $EXTRA_PY_INC ${lib.concatStringsSep " " (map lib.escapeShellArg cflags)} -c "$srcPath" -o "$obj"
          ;;
        *.cpp|*.cc|*.cxx)
        ${empp} -O2 -fPIC -I"$PYODIDE_INCLUDE" $PYODIDE_DEFINES $EXTRA_PY_INC ${lib.concatStringsSep " " (map lib.escapeShellArg cflags)} -c "$srcPath" -o "$obj"
          ;;
      esac
      objs="$objs $obj"
    done

    outRel="${moduleRel}''${EXT_SUFFIX}"
    outDir="$(dirname "$outRel")"
    mkdir -p "build/site/$outDir"

    ${emcc} -O2 -s SIDE_MODULE=1 -s WASM_BIGINT=1 ${lib.concatStringsSep " " (map lib.escapeShellArg ldflags)} $objs -o "build/site/$outRel"
  '';

  installPhase = ''
    set -euo pipefail
    mkdir -p "$out/site"
    cp -R build/site/. "$out/site/"
  '';
}
