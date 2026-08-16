import crypto from "node:crypto";
import { emptyProtectedPyodideIdentity } from "../../ci/protected-rust-patch-pyodide-evidence";

const digest = (value: string) =>
  `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const hashJson = (value: unknown) => digest(JSON.stringify(value));

export function protectedPyodideFixture(caseId: string, state: string) {
  if (caseId !== "rust-pyodide-extension-pr14") return emptyProtectedPyodideIdentity();
  const pyodideBehavior = `RUST_PYODIDE_VALUE=${state === "patched" ? "43" : "42"}`;
  const pyodideAbiIdentity = {
    kind: "pyext_wasm",
    consumerKind: "wasm-app",
    backend: "pyodide",
    requiredExport: "PyInit__native",
    relativePath: "site/demo/_native.so",
    nativeOverlays: 1,
    buildInfoDigest: digest("build-info"),
    abiDigest: digest("abi"),
    abiTarget: "wasm32-unknown-emscripten",
    libc: "emscripten",
    exceptionPolicy: "python-c-api",
    allocator: "emscripten-default",
    runtime: "pyodide",
    targetFeatures: { pthreads: false, atomics: false },
    toolchain: {
      pyodideToolchain: "/nix/store/pyodide",
      pyodideVersion: "0.28.0",
      cpythonVersion: "3.12.0",
      cpythonMinor: "3.12",
      emscripten: "/nix/store/emscripten",
      emscriptenVersion: "3.1.73",
      pythonHeaders: "/nix/store/pyodide/include",
      sysconfig: "/nix/store/pyodide/config/sysconfigdata.py",
      linker: { executable: "/nix/store/emscripten/bin/emcc" },
      pyo3Cross: { enabled: true, implementation: "CPython" },
    },
  };
  return {
    pyodideBehaviorDigest: digest(pyodideBehavior),
    pyodideBehavior,
    pyodideAbiDigest: hashJson(pyodideAbiIdentity),
    pyodideAbiIdentity,
  };
}
