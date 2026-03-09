import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fsp from "node:fs/promises";
import { readFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type WasmModuleManifest = {
  defaultModuleKey: string;
  modules: Array<{
    moduleKey: string;
    sourcePath: string;
    runtimeDestinations: { client: string; server: string };
  }>;
};

function manifestPath(fileName: string): string {
  const contractsDir = String(process.env.MODULE_CONTRACTS_DIR || "").trim();
  if (contractsDir) return path.resolve(contractsDir, fileName);
  return path.resolve(__dirname, fileName);
}

function readManifestJson(): WasmModuleManifest {
  const manifestAbs = manifestPath("wasm-modules.manifest.json");
  try {
    return JSON.parse(readFileSync(manifestAbs, "utf8")) as WasmModuleManifest;
  } catch {
    const mode = process.env.MODULE_CONTRACTS_DIR ? "generated contracts" : "runtime projection";
    throw new Error(`WASM module manifest is missing at expected ${mode} path: ${manifestAbs}`);
  }
}

const manifest = readManifestJson();

function manifestEntryFor(moduleKey: string) {
  if (manifest.modules.length === 0) {
    return null;
  }
  const entry = manifest.modules.find((mod) => mod.moduleKey === moduleKey);
  if (!entry) {
    throw new Error(`unknown wasm module key '${moduleKey}'`);
  }
  return entry;
}

function serverWasmPathFor(moduleKey: string): string {
  const entry = manifestEntryFor(moduleKey);
  if (!entry) {
    return "";
  }
  const serverRuntimeDest = entry.runtimeDestinations.server;
  return path.resolve(__dirname, "..", serverRuntimeDest);
}

export function listWasmModules(): string[] {
  return manifest.modules.map((mod) => mod.moduleKey);
}

export function defaultWasmModuleKey(): string {
  return manifest.defaultModuleKey || "";
}

export async function readServerWasmModuleByteLength(moduleKey: string): Promise<number> {
  const wasmPath = serverWasmPathFor(moduleKey);
  if (!wasmPath) {
    return 0;
  }
  try {
    const bytes = await fsp.readFile(wasmPath);
    return bytes.byteLength;
  } catch {
    throw new Error(
      `server wasm contract asset is missing at canonical runtime path '${wasmPath}' (module '${moduleKey}')`,
    );
  }
}

export async function readServerWasmContractByteLength(): Promise<number> {
  const moduleKey = defaultWasmModuleKey();
  if (!moduleKey) {
    return 0;
  }
  return readServerWasmModuleByteLength(moduleKey);
}
