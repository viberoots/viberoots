import crypto from "node:crypto";
import path from "node:path";
import type { ActiveReviewedRemoteNix } from "../remote-exec/active-reviewed-remote-nix";
import type { ProtectedRustPatchCaseDefinition } from "./protected-rust-patch-case-definitions";

type ExactNix = Pick<ActiveReviewedRemoteNix, "runNix" | "runWithRemoteStore">;

export async function pyodideProtectedPatchIdentity(
  active: ExactNix,
  definition: ProtectedRustPatchCaseDefinition,
  outputPath: string,
  expectedBehavior: "42" | "43",
  opts: { artifactToolsRoot: string },
) {
  if (definition.id !== "rust-pyodide-extension-pr14") {
    return {
      behaviorBytes: null,
      behavior: null,
      pyodideBehaviorDigest: null,
      pyodideBehavior: null,
      pyodideAbiDigest: null,
      pyodideAbiIdentity: null,
    };
  }
  const run = await active.runWithRemoteStore({
    command: path.join(opts.artifactToolsRoot, "bin", "node"),
    args: [path.join(outputPath, "bin", "run.mjs")],
    cwd: "/tmp",
    timeoutMs: 120_000,
  });
  const pyodideBehavior = run.stdout.trim();
  const observed = /RUST_PYODIDE_VALUE=(\d+)/u.exec(pyodideBehavior)?.[1];
  if (observed !== expectedBehavior) {
    throw new Error(
      `protected Rust patch Pyodide run observed ${JSON.stringify(pyodideBehavior)}, expected ${expectedBehavior}: ${definition.id}`,
    );
  }
  const buildInfoBytes = Buffer.from(
    (await active.runNix(["store", "cat", `${outputPath}/BUILD-INFO.json`])).stdout,
  );
  const buildInfo = JSON.parse(buildInfoBytes.toString("utf8"));
  const abiBytes = Buffer.from(
    (
      await active.runNix([
        "store",
        "cat",
        `${outputPath}/share/viberoots-python-wasm/pyemscripten-abi.json`,
      ])
    ).stdout,
  );
  const abi = JSON.parse(abiBytes.toString("utf8"));
  const nativeRelative = await findNativePyodideExtension(active, outputPath, opts);
  const pyodideAbiIdentity = {
    kind: "pyext_wasm",
    consumerKind: buildInfo.kind,
    backend: buildInfo.backend,
    requiredExport: "PyInit__native",
    relativePath: nativeRelative,
    nativeOverlays: buildInfo.nativeOverlays,
    buildInfoDigest: digest(buildInfoBytes),
    abiDigest: digest(abiBytes),
    abiTarget: abi.target,
    libc: "emscripten",
    exceptionPolicy: abi.exceptionPolicy,
    allocator: "emscripten-default",
    runtime: "pyodide",
    targetFeatures: abi.targetFeatures,
    toolchain: {
      pyodideToolchain: abi.pyodideToolchain,
      pyodideVersion: abi.pyodideVersion,
      cpythonVersion: abi.cpythonVersion,
      cpythonMinor: abi.cpythonMinor,
      emscripten: abi.emscripten,
      emscriptenVersion: abi.emscriptenVersion,
      pythonHeaders: abi.pythonHeaders,
      sysconfig: abi.sysconfig,
      linker: abi.linker,
      pyo3Cross: abi.pyo3Cross,
    },
  };
  if (
    buildInfo.kind !== "wasm-app" ||
    buildInfo.backend !== "pyodide" ||
    !nativeRelative ||
    !Number.isInteger(buildInfo.nativeOverlays) ||
    buildInfo.nativeOverlays < 1 ||
    abi.schemaVersion !== "viberoots.rust-pyemscripten.v1" ||
    abi.target !== "wasm32-unknown-emscripten" ||
    abi.exceptionPolicy !== "python-c-api" ||
    abi.targetFeatures?.pthreads !== false ||
    abi.targetFeatures?.atomics !== false
  ) {
    throw new Error(`protected Rust patch lacks PyEmscripten ABI identity: ${definition.id}`);
  }
  return {
    behaviorBytes: Buffer.from(observed),
    behavior: observed,
    pyodideBehaviorDigest: digest(Buffer.from(pyodideBehavior)),
    pyodideBehavior,
    pyodideAbiDigest: digest(Buffer.from(JSON.stringify(pyodideAbiIdentity))),
    pyodideAbiIdentity,
  };
}

async function findNativePyodideExtension(
  active: ExactNix,
  outputPath: string,
  opts: { artifactToolsRoot: string },
): Promise<string | undefined> {
  const listing = await active.runWithRemoteStore({
    command: path.join(opts.artifactToolsRoot, "bin", "node"),
    args: ["-e", recursiveListingScript, outputPath],
    cwd: "/tmp",
    timeoutMs: 120_000,
  });
  return (JSON.parse(listing.stdout) as string[]).find((file) =>
    /^site\/.*\/_native(?:\.[^/]+)?\.so$/u.test(file),
  );
}

const recursiveListingScript = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const root = process.argv[1];",
  "const files = [];",
  "const walk = (dir) => {",
  "  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {",
  "    const full = path.join(dir, entry.name);",
  "    if (entry.isDirectory()) walk(full);",
  "    else files.push(path.relative(root, full));",
  "  }",
  "};",
  "walk(root);",
  "console.log(JSON.stringify(files));",
].join(" ");

function digest(value: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
