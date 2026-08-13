{
  pkgs,
  lib,
  kind,
  crate,
  module,
  targetDir,
  buildPyDeps,
  pythonWheelhouse,
  wasmStaticLibs ? [],
  wasmStaticArchives ? [],
}:
let
  enabled = kind == "pyext_wasm";
  Abi = import ./python/pyemscripten-abi.nix { inherit pkgs lib; };
  Pyodide = Abi.pyodide;
  crateFile = lib.replaceStrings [ "-" ] [ "_" ] crate;
  moduleRel = lib.replaceStrings [ "." ] [ "/" ] module;
  moduleLeaf = lib.last (lib.splitString "." module);
  config = Abi.validateConfig (Abi.config // {
    schemaVersion = "viberoots.rust-pyemscripten.v1";
    sideModule = true;
    requiredExport = "PyInit_${moduleLeaf}";
    pyo3Cross = Abi.config.pyo3Cross // {
      configFile = builtins.toString pyo3ConfigFile;
    };
  });
  pyo3ConfigFile = pkgs.writeText "pyo3-pyodide-cross-config.txt" ''
    implementation=CPython
    version=${Abi.config.pyo3Cross.version}
    shared=true
    abi3=false
    lib_name=python${Abi.config.pyo3Cross.version}
    lib_dir=${Abi.config.pyo3Cross.libDir}
    pointer_width=32
    build_flags=
    suppress_build_script_link_lines=true
  '';
  wasmStaticLibDirs = map (pkg: "${pkg}/lib") wasmStaticLibs;
  wasmStaticIncludeDirs = map (pkg: "${pkg}/include") wasmStaticLibs;
  wasmStaticArchiveFlags =
    lib.concatMap (archive: [ "-C" "link-arg=${archive}" ]) wasmStaticArchives;
  installedShape = {
    kind = "pyext_wasm";
    module = module;
    modulePath = moduleRel;
    siteRoot = "site";
    extensionSuffixFile = Abi.extSuffix;
    relativePath = "site/${moduleRel}__VIBEROOTS_PYEXT_SUFFIX__";
    requiredExport = "PyInit_${moduleLeaf}";
  };
in {
  inherit enabled config installedShape;
  nativeBuildInputs = lib.optionals enabled [ Abi.emscripten pkgs.nodejs_22 pkgs.wabt ];
  buildInputs = lib.optionals enabled [ Pyodide ]
    ++ lib.optionals (enabled && pythonWheelhouse != null) [ pythonWheelhouse ];
  includePaths = lib.optionals enabled ([ Abi.includeDir ] ++ wasmStaticIncludeDirs);
  rustFlags = lib.optionals enabled (
    (map (dir: "-Lnative=${dir}") wasmStaticLibDirs)
    ++ wasmStaticArchiveFlags
    ++ (lib.concatMap (flag: [ "-C" "link-arg=${flag}" ]) Abi.rustSideModuleFlags)
  );
  envAttrs = lib.optionalAttrs enabled {
    CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER = Abi.emcc;
    PYO3_CROSS = "1";
    PYO3_CROSS_PYTHON_VERSION = Abi.config.pyo3Cross.version;
    PYO3_CROSS_PYTHON_IMPLEMENTATION = "CPython";
    PYO3_CROSS_LIB_DIR = Abi.config.pyo3Cross.libDir;
    PYO3_CONFIG_FILE = pyo3ConfigFile;
  };
  preBuild = lib.optionalString enabled ''
    export HOME="$TMPDIR/home"
    export EM_CACHE="$TMPDIR/emscripten-cache"
    export PYTHONNOUSERSITE=1
    mkdir -p "$HOME" "$EM_CACHE"
    test -f ${Abi.extSuffix}
    test -f ${Abi.sysconfig}
    test -f ${pyo3ConfigFile}
    test -d ${Abi.includeDir}
    test -d ${Abi.config.pyo3Cross.libDir}
    grep -q '^implementation=CPython$' ${pyo3ConfigFile}
    grep -q '^version=${Abi.config.pyo3Cross.version}$' ${pyo3ConfigFile}
    grep -q '^lib_dir=${Abi.config.pyo3Cross.libDir}$' ${pyo3ConfigFile}
    grep -q '^pointer_width=32$' ${pyo3ConfigFile}
    grep -q '^suppress_build_script_link_lines=true$' ${pyo3ConfigFile}
    for archive in ${lib.concatStringsSep " " (map lib.escapeShellArg wasmStaticArchives)}; do
      test -f "$archive" || { echo "rust Pyodide extension ${crate}: missing declared wasm static archive $archive" >&2; exit 2; }
    done
    ${lib.optionalString (buildPyDeps != []) ''
      export PYTHONPATH="${pythonWheelhouse}/site"
      for package in ${lib.concatStringsSep " " (map lib.escapeShellArg buildPyDeps)}; do
        ${pkgs.python3}/bin/python -c 'import importlib, sys; importlib.import_module(sys.argv[1])' "$package" ||
          { echo "Rust Pyodide extension build_py_deps package $package is not importable from the selected uv.lock wheelhouse" >&2; exit 2; }
      done
    ''}
  '';
  installPhase = lib.optionalString enabled ''
    runHook preInstall
    EXT_SUFFIX="$(cat ${Abi.extSuffix})"
    test -n "$EXT_SUFFIX" || { echo "rust Pyodide extension ${crate}: Pyodide EXT_SUFFIX is empty" >&2; exit 2; }
    shopt -s nullglob
    primary_candidates=(
      "${targetDir}/${crateFile}.wasm"
      "${targetDir}/lib${crateFile}.wasm"
    )
    fallback_candidates=(
      "${targetDir}/deps/${crateFile}.wasm"
      "${targetDir}/deps/lib${crateFile}.wasm"
    )
    matches=()
    for candidate in "''${primary_candidates[@]}"; do
      [ -f "$candidate" ] && matches+=("$candidate")
    done
    if [ "''${#matches[@]}" -eq 0 ]; then
      for candidate in "''${fallback_candidates[@]}"; do
        [ -f "$candidate" ] && matches+=("$candidate")
      done
    fi
    if [ "''${#matches[@]}" -ne 1 ]; then
      echo "rust Pyodide extension ${crate}: expected one wasm side module for crate ${crateFile}, found ''${#matches[@]}" >&2
      exit 2
    fi
    candidate="''${matches[0]}"
    dump="$TMPDIR/${crateFile}.wasm-objdump.txt"
    ${pkgs.wabt}/bin/wasm-objdump -x "$candidate" > "$dump"
    ${pkgs.python3}/bin/python - "$dump" "PyInit_${moduleLeaf}" <<'PY'
import re
import sys

dump_path, required = sys.argv[1], sys.argv[2]
text = open(dump_path, encoding="utf8").read()
if required not in text:
    raise SystemExit(f"rust Pyodide extension: missing {required} export")
for forbidden in ("atomics", "shared-mem", "target_features: +atomics"):
    if forbidden in text:
        raise SystemExit(f"rust Pyodide extension: unsupported pthread/atomic feature detected: {forbidden}")
exports = set()
in_exports = False
for line in text.splitlines():
    if re.match(r"^Export\[", line):
        in_exports = True
        continue
    if in_exports and re.match(r"^[A-Za-z_].*\[", line):
        break
    if in_exports:
        match = re.search(r"->\\s+\"([^\"]+)\"", line) or re.search(r"<([^>]+)>", line)
        if match:
            exports.add(match.group(1))
allowed = {required, "__wasm_call_ctors", "__wasm_apply_data_relocs", "__wasm_apply_global_relocs"}
def rust_internal(name):
    return name.startswith("_ZN") or name.startswith("_RNv") or name.startswith("__rust")
unexpected = sorted(
    name for name in exports
    if name not in allowed
    and not name.startswith("__start_")
    and not name.startswith("__stop_")
    and not rust_internal(name)
)
if unexpected:
    raise SystemExit("rust Pyodide extension: unexpected public exports: " + ", ".join(unexpected))
PY
    module_rel=${lib.escapeShellArg moduleRel}
    install -Dm755 "$candidate" "$out/site/$module_rel$EXT_SUFFIX"
    mkdir -p "$out/share/viberoots-rust"
    printf '%s\n' ${lib.escapeShellArg (builtins.toJSON config)} > "$out/share/viberoots-rust/pyemscripten-abi.json"
    ${pkgs.nodejs_22}/bin/node --input-type=module <<'JS'
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const runtimeDirRaw = "${Abi.runtimeDir}";
const runtimeDir = (() => {
  const marker = runtimeDirRaw.indexOf("file:");
  if (marker !== -1) {
    return fileURLToPath(runtimeDirRaw.slice(marker));
  }
  return runtimeDirRaw;
})();
let indexURL = path.resolve(runtimeDir) + path.sep;
if (indexURL.includes("file:")) {
  indexURL = fileURLToPath(indexURL.slice(indexURL.indexOf("file:"))) + path.sep;
}
const { loadPyodide } = await import(pathToFileURL(path.join(runtimeDir, "pyodide.mjs")).href);
const baseFetch = globalThis.fetch.bind(globalThis);
const fileFetch = async (url, init) => {
  const target = typeof url === "string" ? url : url?.url || String(url);
  let filePath = null;
  if (target.startsWith("file:/")) {
    filePath = target.slice("file:".length);
  } else if (target.startsWith("file:")) {
    filePath = fileURLToPath(target);
  } else if (target.includes("file:")) {
    filePath = fileURLToPath(target.slice(target.indexOf("file:")));
  } else if (path.isAbsolute(target)) {
    filePath = target;
  }
  if (filePath) return new Response(await fs.readFile(filePath));
  return baseFetch(target, init);
};
const pyodide = await loadPyodide({
  indexURL,
  fetch: fileFetch,
});
pyodide.FS.mkdir("/site");
pyodide.FS.mount(pyodide.FS.filesystems.NODEFS, { root: path.join(process.env.out, "site") }, "/site");
await pyodide.runPythonAsync(`import sys, importlib; sys.path.insert(0, "/site"); importlib.import_module("${module}")`);
JS
    runHook postInstall
  '';
}
