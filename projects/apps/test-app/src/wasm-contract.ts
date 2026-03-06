import wasmManifest from "./wasm-modules.manifest.json";

type WasmModuleManifest = {
  defaultModuleKey: string;
  modules: Array<{
    moduleKey: string;
    sourcePath: string;
    runtimeDestinations: { client: string; server: string };
  }>;
};

const manifest = wasmManifest as WasmModuleManifest;

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

export function listWasmModules(): string[] {
  return manifest.modules.map((mod) => mod.moduleKey);
}

export function defaultWasmModuleKey(): string {
  return manifest.defaultModuleKey || "";
}

export async function readWasmModuleBytes(moduleKey: string): Promise<Uint8Array> {
  const entry = manifestEntryFor(moduleKey);
  if (!entry) {
    return new Uint8Array();
  }
  const wasmUrl = new URL(
    `/${entry.sourcePath.replace(/^\.\//, "")}`,
    window.location.href,
  ).toString();
  const res = await fetch(wasmUrl);
  if (!res.ok) {
    throw new Error(`failed to load wasm module '${moduleKey}': ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function readWasmContractBytes(): Promise<Uint8Array> {
  const moduleKey = defaultWasmModuleKey();
  if (!moduleKey) {
    return new Uint8Array();
  }
  return readWasmModuleBytes(moduleKey);
}
