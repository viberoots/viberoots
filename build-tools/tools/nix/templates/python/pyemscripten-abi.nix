{ pkgs, lib }:
let
  pyodide = import ../../toolchains/pyodide.nix { inherit pkgs; };
  emscripten = pkgs.emscripten;
  pyVersion = pyodide.pythonVersion;
  expected = {
    target = "wasm32-unknown-emscripten";
    pyodideToolchain = builtins.toString pyodide;
    cpythonVersion = pyVersion;
    cpythonMinor = "${lib.versions.major pyVersion}.${lib.versions.minor pyVersion}";
    emscripten = builtins.toString emscripten;
    extensionSuffix = "${pyodide}/config/ext-suffix.txt";
    sysconfig = "${pyodide}/config/sysconfigdata.py";
    pyo3LibDir = "${pyodide}";
    pythonHeaders = "${pyodide}/include";
    exceptionPolicy = "python-c-api";
  };
  fail = field: want: got:
    builtins.throw "PyEmscripten ABI mismatch for ${field}: expected ${builtins.toString want}; got ${builtins.toString got}";
  validateConfig = cfg:
    if (cfg.target or "") != expected.target then fail "target" expected.target (cfg.target or "")
    else if (cfg.pyodideToolchain or "") != expected.pyodideToolchain then fail "pyodideToolchain" expected.pyodideToolchain (cfg.pyodideToolchain or "")
    else if (cfg.cpythonVersion or "") != expected.cpythonVersion then fail "cpythonVersion" expected.cpythonVersion (cfg.cpythonVersion or "")
    else if (cfg.cpythonMinor or "") != expected.cpythonMinor then fail "cpythonMinor" expected.cpythonMinor (cfg.cpythonMinor or "")
    else if (cfg.emscripten or "") != expected.emscripten then fail "emscripten" expected.emscripten (cfg.emscripten or "")
    else if (cfg.extensionSuffix or "") != expected.extensionSuffix then fail "extensionSuffix" expected.extensionSuffix (cfg.extensionSuffix or "")
    else if (cfg.sysconfig or "") != expected.sysconfig then fail "sysconfig" expected.sysconfig (cfg.sysconfig or "")
    else if (cfg.pythonHeaders or "") != expected.pythonHeaders then fail "pythonHeaders" expected.pythonHeaders (cfg.pythonHeaders or "")
    else if ((cfg.targetFeatures or {}).pthreads or false) != false then fail "targetFeatures.pthreads" false true
    else if ((cfg.targetFeatures or {}).atomics or false) != false then fail "targetFeatures.atomics" false true
    else if (cfg.exceptionPolicy or "") != expected.exceptionPolicy then fail "exceptionPolicy" expected.exceptionPolicy (cfg.exceptionPolicy or "")
    else if ((cfg.pyo3Cross or {}).enabled or false) != true then fail "pyo3Cross.enabled" true false
    else if ((cfg.pyo3Cross or {}).implementation or "") != "CPython" then fail "pyo3Cross.implementation" "CPython" ((cfg.pyo3Cross or {}).implementation or "")
    else if ((cfg.pyo3Cross or {}).version or "") != expected.cpythonMinor then fail "pyo3Cross.version" expected.cpythonMinor ((cfg.pyo3Cross or {}).version or "")
    else if ((cfg.pyo3Cross or {}).sysconfig or "") != expected.sysconfig then fail "pyo3Cross.sysconfig" expected.sysconfig ((cfg.pyo3Cross or {}).sysconfig or "")
    else if ((cfg.pyo3Cross or {}).libDir or "") != expected.pyo3LibDir then fail "pyo3Cross.libDir" expected.pyo3LibDir ((cfg.pyo3Cross or {}).libDir or "")
    else cfg;
in {
  inherit pyodide emscripten;
  emcc = "${emscripten}/bin/emcc";
  empp = "${emscripten}/bin/em++";
  includeDir = "${pyodide}/include";
  sysconfig = "${pyodide}/config/sysconfigdata.py";
  extSuffix = "${pyodide}/config/ext-suffix.txt";
  runtimeDir = "${pyodide}/runtime";
  sideModuleFlags = [ "-sSIDE_MODULE=1" "-sWASM_BIGINT=1" "-sERROR_ON_UNDEFINED_SYMBOLS=0" ];
  rustSideModuleFlags = [ "-sSIDE_MODULE=2" "-sWASM_BIGINT=1" "-sERROR_ON_UNDEFINED_SYMBOLS=0" ];
  inherit validateConfig;
  config = validateConfig {
    schemaVersion = "viberoots.pyemscripten-abi.v1";
    target = "wasm32-unknown-emscripten";
    pyodideToolchain = builtins.toString pyodide;
    pyodideVersion = pyodide.version;
    cpythonVersion = pyVersion;
    cpythonMinor = "${lib.versions.major pyVersion}.${lib.versions.minor pyVersion}";
    emscripten = builtins.toString emscripten;
    emscriptenVersion = emscripten.version or "unknown";
    extensionSuffix = "${pyodide}/config/ext-suffix.txt";
    sysconfig = "${pyodide}/config/sysconfigdata.py";
    pythonHeaders = "${pyodide}/include";
    targetFeatures = { pthreads = false; atomics = false; };
    exceptionPolicy = "python-c-api";
    pyo3Cross = {
      enabled = true;
      implementation = "CPython";
      version = "${lib.versions.major pyVersion}.${lib.versions.minor pyVersion}";
      sysconfig = "${pyodide}/config/sysconfigdata.py";
      libDir = "${pyodide}";
    };
    linker = {
      executable = "${emscripten}/bin/emcc";
      flags = [ "-sSIDE_MODULE=1" "-sWASM_BIGINT=1" "-sERROR_ON_UNDEFINED_SYMBOLS=0" ];
      rustFlags = [ "-sSIDE_MODULE=2" "-sWASM_BIGINT=1" "-sERROR_ON_UNDEFINED_SYMBOLS=0" ];
    };
  };
}
