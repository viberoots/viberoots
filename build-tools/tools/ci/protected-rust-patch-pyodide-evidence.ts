import crypto from "node:crypto";
import { protectedDigestShape as digestShape } from "./protected-rust-patch-evidence-utils";

type ProtectedPhasePyodideFields = {
  behavior: string;
  pyodideAbiDigest: string | null;
  pyodideAbiIdentity: unknown | null;
  pyodideBehavior: string | null;
  pyodideBehaviorDigest: string | null;
};

export function emptyProtectedPyodideIdentity() {
  return {
    pyodideBehaviorDigest: null,
    pyodideBehavior: null,
    pyodideAbiDigest: null,
    pyodideAbiIdentity: null,
  };
}

export function assertProtectedRustPatchPyodideIdentity(
  caseId: string,
  phase: ProtectedPhasePyodideFields,
): void {
  if (caseId === "rust-pyodide-extension-pr14") {
    const pyodideBehavior = String(phase.pyodideBehavior || "");
    const pyodideAbiIdentity = phase.pyodideAbiIdentity as Record<string, unknown> | null;
    if (
      !phase.pyodideBehaviorDigest ||
      !digestShape(phase.pyodideBehaviorDigest) ||
      phase.pyodideBehaviorDigest !== digest(Buffer.from(pyodideBehavior)) ||
      !phase.pyodideAbiDigest ||
      !digestShape(phase.pyodideAbiDigest) ||
      !pyodideAbiIdentity ||
      phase.pyodideAbiDigest !== digest(Buffer.from(JSON.stringify(pyodideAbiIdentity))) ||
      !pyodideBehavior.includes(`RUST_PYODIDE_VALUE=${phase.behavior}`) ||
      pyodideAbiIdentity.kind !== "pyext_wasm" ||
      pyodideAbiIdentity.consumerKind !== "wasm-app" ||
      pyodideAbiIdentity.backend !== "pyodide" ||
      pyodideAbiIdentity.requiredExport !== "PyInit__native" ||
      !String(pyodideAbiIdentity.relativePath || "").match(/^site\/.*\.so$/u) ||
      !Number.isInteger(pyodideAbiIdentity.nativeOverlays) ||
      pyodideAbiIdentity.abiTarget !== "wasm32-unknown-emscripten" ||
      pyodideAbiIdentity.libc !== "emscripten" ||
      pyodideAbiIdentity.exceptionPolicy !== "python-c-api" ||
      pyodideAbiIdentity.allocator !== "emscripten-default" ||
      pyodideAbiIdentity.runtime !== "pyodide" ||
      !digestShape(String(pyodideAbiIdentity.abiDigest || "")) ||
      (pyodideAbiIdentity.targetFeatures as { pthreads?: boolean } | undefined)?.pthreads !==
        false ||
      (pyodideAbiIdentity.targetFeatures as { atomics?: boolean } | undefined)?.atomics !== false ||
      !validToolchain(pyodideAbiIdentity.toolchain)
    ) {
      throw new Error(`protected Rust patch evidence lacks Pyodide identity: ${caseId}`);
    }
  } else if (
    phase.pyodideBehaviorDigest !== null ||
    phase.pyodideBehavior !== null ||
    phase.pyodideAbiDigest !== null ||
    phase.pyodideAbiIdentity !== null
  ) {
    throw new Error(`non-Pyodide protected Rust patch has Pyodide identity: ${caseId}`);
  }
}

const digest = (value: Buffer) =>
  `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;

function validToolchain(value: unknown): boolean {
  const toolchain = value as Record<string, unknown> | null;
  if (!toolchain || typeof toolchain !== "object" || Array.isArray(toolchain)) return false;
  return [
    "pyodideToolchain",
    "pyodideVersion",
    "cpythonVersion",
    "cpythonMinor",
    "emscripten",
    "emscriptenVersion",
    "pythonHeaders",
    "sysconfig",
    "linker",
    "pyo3Cross",
  ].every((key) => toolchain[key] !== undefined);
}
