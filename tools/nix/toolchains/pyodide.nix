{ pkgs }:
let
  pyodideVersion = "0.27.0";
  pythonVersion = "3.12.7";
  toolchainVersion = "${pyodideVersion}.6";
  pyodideTar = pkgs.fetchurl {
    url = "https://github.com/pyodide/pyodide/releases/download/${pyodideVersion}/pyodide-${pyodideVersion}.tar.bz2";
    sha256 = "sha256-i5nt/6ynt+BpoP+rCHfDy0vieL6H6Jr86wOmlH7SQcc=";
  };
  pyodideSrcTar = pkgs.fetchurl {
    url = "https://github.com/pyodide/pyodide/archive/refs/tags/${pyodideVersion}.tar.gz";
    sha256 = "sha256-nmqwMZM+9+eJSEEG9Ke7liKLvSI4pbK1+0UycwVkK84=";
  };
  pythonTar = pkgs.fetchurl {
    url = "https://www.python.org/ftp/python/${pythonVersion}/Python-${pythonVersion}.tgz";
    sha256 = "sha256-c6yP54Aie/Nxrdg3PDB59CoNxi3v+NYSzRWmGAgqtiM=";
  };
in
pkgs.stdenvNoCC.mkDerivation {
  pname = "pyodide-toolchain";
  version = toolchainVersion;
  inherit pythonVersion;
  python = pkgs.python312;
  nativeBuildInputs = [ pkgs.coreutils pkgs.patch pkgs.unzip pkgs.python312 ];
  dontUnpack = true;
  buildPhase = ''
    set -euo pipefail
    mkdir -p work
    tar xf ${pyodideTar} -C work
    tar xf ${pyodideSrcTar} -C work
    tar xf ${pythonTar} -C work
    unzip -q work/pyodide/python_stdlib.zip _sysconfigdata__emscripten_wasm32-emscripten.py -d work

    sysconfigSrc="$PWD/work/_sysconfigdata__emscripten_wasm32-emscripten.py"
    if [ ! -f "$sysconfigSrc" ]; then
      echo "pyodide toolchain: missing pyodide sysconfig data at $sysconfigSrc" >&2
      exit 2
    fi

    mkdir -p "$out/config"
    cp "$sysconfigSrc" "$out/config/sysconfigdata.py"

    PYODIDE_SYSCONFIG="$sysconfigSrc" \
    OUT_DIR="$out/config" \
    ${pkgs.python312}/bin/python - <<'PY'
import importlib.util
import os
import sys

cfg = os.environ["PYODIDE_SYSCONFIG"]
out_dir = os.environ["OUT_DIR"]

spec = importlib.util.spec_from_file_location("pyodide_sysconfig", cfg)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
vars = getattr(mod, "build_time_vars", {})

ext = vars.get("EXT_SUFFIX", "")
if not ext:
    raise SystemExit("pyodide toolchain: EXT_SUFFIX missing from sysconfig data")

soabi = vars.get("SOABI", "")
pyver = vars.get("VERSION", "")
abi = vars.get("PYODIDE_ABI_VERSION", "")

def write(name, value):
    with open(os.path.join(out_dir, name), "w", encoding="utf8") as f:
        f.write(value or "")

write("ext-suffix.txt", ext)
write("soabi.txt", soabi)
write("python-version.txt", pyver)
write("pyodide-abi-version.txt", abi)
PY

    pySrc="$PWD/work/Python-${pythonVersion}"
    pyodideSrc="$PWD/work/pyodide-${pyodideVersion}"
    patchesDir="$pyodideSrc/cpython/patches"

    if [ ! -d "$pySrc" ]; then
      echo "pyodide toolchain: missing CPython source at $pySrc" >&2
      exit 2
    fi
    if [ ! -d "$patchesDir" ]; then
      echo "pyodide toolchain: missing pyodide patches at $patchesDir" >&2
      exit 2
    fi
    cd "$pySrc"
    for p in "$patchesDir"/*.patch; do
      patch -p1 < "$p"
    done

    pyconfigIn="$PWD/pyconfig.h.in"
    if [ ! -f "$pyconfigIn" ]; then
      echo "pyodide toolchain: missing pyconfig.h.in at $pyconfigIn" >&2
      exit 2
    fi

    mkdir -p "$out/include"
    cp -R Include/. "$out/include/"
    PYODIDE_SYSCONFIG="$sysconfigSrc" \
    PYCONFIG_IN="$pyconfigIn" \
    PYCONFIG_OUT="$out/include/pyconfig.h" \
    ${pkgs.python312}/bin/python - <<'PY'
import os
import re

cfg = os.environ["PYODIDE_SYSCONFIG"]
pyconfig_in = os.environ["PYCONFIG_IN"]
pyconfig_out = os.environ["PYCONFIG_OUT"]

ns = {}
with open(cfg, "r", encoding="utf8") as f:
    exec(f.read(), ns)
vars = ns.get("build_time_vars", {})

undef_plain = re.compile(r"^\\s*#undef\\s+([A-Za-z0-9_]+)\\b")
undef_cmt = re.compile(r"^\\s*/\\*\\s*#undef\\s+([A-Za-z0-9_]+)\\s*\\*/")

def render_define(key, value):
    if isinstance(value, bool):
        return f"#define {key} {1 if value else 0}\n"
    if isinstance(value, int):
        return f"#define {key} {value}\n"
    if isinstance(value, str):
        return f"#define {key} \"{value}\"\n"
    return None

required = [
    "HAVE_PTHREAD_H",
    "HAVE_SSIZE_T",
    "SIZEOF_INT",
    "SIZEOF_LONG",
    "SIZEOF_LONG_LONG",
    "SIZEOF_SIZE_T",
    "SIZEOF_VOID_P",
    "SIZEOF_WCHAR_T",
]

out_lines = []
with open(pyconfig_in, "r", encoding="utf8") as f:
    for line in f:
        m = undef_plain.match(line) or undef_cmt.match(line)
        if not m:
            out_lines.append(line)
            continue
        key = m.group(1)
        if key in vars:
            rendered = render_define(key, vars[key])
            if rendered is not None:
                out_lines.append(rendered)
                continue
        out_lines.append(line)

# Ensure required defines are present even if the template omits them.
for key in required:
    rendered = render_define(key, vars.get(key))
    if rendered is None:
        raise SystemExit(f"pyodide toolchain: missing sysconfig value for {key}")
    out_lines.append(rendered)

with open(pyconfig_out, "w", encoding="utf8") as f:
    f.writelines(out_lines)
PY
  '';
  installPhase = "true";
}
