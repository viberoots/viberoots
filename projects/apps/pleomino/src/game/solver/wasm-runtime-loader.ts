import { SOLVER_WASM_BASE64 } from "./wasm-inline";

type SolverWasmExports = {
  memory: WebAssembly.Memory;
  solver_alloc?: (byteCount: number) => number;
  _solver_alloc?: (byteCount: number) => number;
  solver_free?: (ptr: number) => void;
  _solver_free?: (ptr: number) => void;
  solver_search?: (...args: number[]) => number;
  _solver_search?: (...args: number[]) => number;
};

let cachedExportsPromise: Promise<SolverWasmExports> | null = null;
let cachedWasmBytesPromise: Promise<Uint8Array> | null = null;

function decodeBase64ToBytes(base64: string): Uint8Array {
  const decoded =
    typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function isBrowserRuntime(): boolean {
  if (typeof window !== "undefined") {
    return true;
  }
  return (
    typeof WorkerGlobalScope !== "undefined" &&
    typeof self !== "undefined" &&
    self instanceof WorkerGlobalScope
  );
}

function resolveWasmUrl(): URL {
  return new URL("../../wasm-contract/pleomino-solver.wasm", import.meta.url);
}

async function readCachedWasmBytes(wasmUrl: URL): Promise<Uint8Array | null> {
  if (typeof caches === "undefined") {
    return null;
  }
  const cachedResponse =
    (await caches.match(wasmUrl.toString())) ??
    (await caches.match(wasmUrl.pathname)) ??
    (await caches.match(new Request(wasmUrl.toString())));
  if (!cachedResponse?.ok) {
    return null;
  }
  return new Uint8Array(await cachedResponse.arrayBuffer());
}

async function readWasmBytes(): Promise<Uint8Array> {
  if (!cachedWasmBytesPromise) {
    cachedWasmBytesPromise = (async () => {
      const wasmUrl = resolveWasmUrl();
      if (!isBrowserRuntime()) {
        const fsp = await import("node:fs/promises");
        return new Uint8Array(await fsp.readFile(wasmUrl));
      }
      if (SOLVER_WASM_BASE64.length > 0) {
        return decodeBase64ToBytes(SOLVER_WASM_BASE64);
      }
      const response = await fetch(
        wasmUrl.toString(),
        import.meta.env.DEV ? { cache: "no-store" } : undefined,
      );
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }
      const cachedBytes = await readCachedWasmBytes(wasmUrl);
      if (cachedBytes) {
        return cachedBytes;
      }
      throw new Error(`failed to load solver wasm: ${response.status}`);
    })().catch(async (error) => {
      const cachedBytes = await readCachedWasmBytes(resolveWasmUrl());
      if (cachedBytes) {
        return cachedBytes;
      }
      cachedWasmBytesPromise = null;
      throw error;
    });
  }
  return cachedWasmBytesPromise;
}

function buildWasmImports(module: WebAssembly.Module): WebAssembly.Imports {
  const wasiImport = (name: string): ((...args: number[]) => number) | null => {
    if (name === "clock_time_get") {
      return () => 52;
    }
    if (name === "fd_fdstat_get" || name === "fd_write" || name === "fd_read") {
      return () => 8;
    }
    return null;
  };
  const imports: Record<string, Record<string, unknown>> = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    const moduleImports = imports[imp.module] ?? {};
    imports[imp.module] = moduleImports;
    if (imp.kind === "function") {
      if (imp.module === "wasi_snapshot_preview1") {
        const wasi = wasiImport(imp.name);
        if (wasi) {
          moduleImports[imp.name] = wasi;
          continue;
        }
      }
      moduleImports[imp.name] = () => 0;
      continue;
    }
    if (imp.kind === "global") {
      const type = (imp as { type?: { value?: string; mutable?: boolean } }).type;
      const value =
        type?.value === "i64" || type?.value === "f32" || type?.value === "f64"
          ? type.value
          : "i32";
      moduleImports[imp.name] = new WebAssembly.Global(
        { value, mutable: type?.mutable ?? true },
        0,
      );
      continue;
    }
    if (imp.kind === "memory") {
      moduleImports[imp.name] = new WebAssembly.Memory({ initial: 256 });
      continue;
    }
    if (imp.kind === "table") {
      moduleImports[imp.name] = new WebAssembly.Table({ initial: 1, element: "anyfunc" });
    }
  }
  return imports as WebAssembly.Imports;
}

async function loadSolverWasmExports(): Promise<SolverWasmExports> {
  if (!cachedExportsPromise) {
    cachedExportsPromise = (async () => {
      const bytes = await readWasmBytes();
      const module = new WebAssembly.Module(bytes as BufferSource);
      const instance = await WebAssembly.instantiate(module, buildWasmImports(module));
      const exports = instance.exports as unknown as SolverWasmExports;
      if (!(exports.memory instanceof WebAssembly.Memory)) {
        throw new Error("solver wasm memory export is missing");
      }
      if (!(exports.solver_search || exports._solver_search)) {
        throw new Error("solver wasm search export is missing");
      }
      return exports;
    })();
  }
  return cachedExportsPromise;
}

export function prewarmSolverWasmAsset(): void {
  void readWasmBytes().catch(() => {
    // Ignore warmup failures so regular solve attempts can retry later.
  });
}

export function resetSolverWasmForTests(): void {
  cachedExportsPromise = null;
  cachedWasmBytesPromise = null;
}

export async function loadSolverSearchExports(): Promise<SolverWasmExports> {
  return loadSolverWasmExports();
}
