import type { SolverPreparedInput } from "./solver-types";

type SolverWasmExports = {
  memory: WebAssembly.Memory;
  solver_alloc?: (byteCount: number) => number;
  _solver_alloc?: (byteCount: number) => number;
  solver_free?: (ptr: number) => void;
  _solver_free?: (ptr: number) => void;
  solver_search?: (...args: number[]) => number;
  _solver_search?: (...args: number[]) => number;
};

export type WasmSearchResult = {
  statusCode: number;
  nodeExpansions: number;
  solutions: readonly {
    foundAtNode: number;
    candidateIndices: Int32Array;
  }[];
};

let cachedExportsPromise: Promise<SolverWasmExports> | null = null;
let cachedWasmBytesPromise: Promise<Uint8Array> | null = null;

function resolveWasmUrl(): URL {
  return new URL("../../wasm-contract/pleomino-solver.wasm", import.meta.url);
}

async function readWasmBytes(): Promise<Uint8Array> {
  if (!cachedWasmBytesPromise) {
    cachedWasmBytesPromise = (async () => {
      const wasmUrl = resolveWasmUrl();
      if (typeof window === "undefined") {
        const fsp = await import("node:fs/promises");
        return new Uint8Array(await fsp.readFile(wasmUrl));
      }
      const response = await fetch(
        wasmUrl.toString(),
        import.meta.env.DEV ? { cache: "no-store" } : undefined,
      );
      if (!response.ok) {
        throw new Error(`failed to load solver wasm: ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    })().catch((error) => {
      cachedWasmBytesPromise = null;
      throw error;
    });
  }
  return cachedWasmBytesPromise;
}

export function prewarmSolverWasmAsset(): void {
  void readWasmBytes().catch(() => {
    // Ignore warmup failures so regular solve attempts can retry later.
  });
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

function byteLengthForArray(array: Int32Array | Uint32Array): number {
  return array.length * 4;
}

function writeI32(memory: WebAssembly.Memory, ptr: number, values: Int32Array): void {
  new Int32Array(memory.buffer, ptr, values.length).set(values);
}

function writeU32(memory: WebAssembly.Memory, ptr: number, values: Uint32Array): void {
  new Uint32Array(memory.buffer, ptr, values.length).set(values);
}

function readI32Value(memory: WebAssembly.Memory, ptr: number): number {
  return new Int32Array(memory.buffer, ptr, 1)[0] ?? 0;
}

export async function runSolverSearchInWasm(
  prepared: SolverPreparedInput,
  maxNodeExpansions: number,
  maxWallClockMs: number,
  solutionPoolSize: number,
): Promise<WasmSearchResult> {
  const exports = await loadSolverWasmExports();
  const solverAlloc = exports.solver_alloc ?? exports._solver_alloc;
  const solverFree = exports.solver_free ?? exports._solver_free;
  const solverSearch = exports.solver_search ?? exports._solver_search;
  if (!solverAlloc || !solverFree || !solverSearch) {
    throw new Error("solver wasm allocator/search exports are missing");
  }

  const pieceInventory = prepared.pieceInventory;
  const candidatePieceTypes = prepared.candidatePieceTypes;
  const candidateMasks = prepared.candidateMasks;
  const cellStarts = prepared.cellStarts;
  const cellCandidateIndices = prepared.cellCandidateIndices;
  const lockedMask = prepared.lockedMask;
  const outCandidatesCapacity = Math.max(0, prepared.boardCellCount);
  const outSolutionCapacity = Math.max(1, Math.trunc(solutionPoolSize));

  const ptrs: number[] = [];
  const alloc = (bytes: number) => {
    const ptr = solverAlloc(bytes);
    if (!ptr) {
      throw new Error("solver wasm allocation failed");
    }
    ptrs.push(ptr);
    return ptr;
  };

  try {
    const pieceInventoryPtr = alloc(byteLengthForArray(pieceInventory));
    const candidatePieceTypesPtr = alloc(byteLengthForArray(candidatePieceTypes));
    const candidateMasksPtr = alloc(byteLengthForArray(candidateMasks));
    const cellStartsPtr = alloc(byteLengthForArray(cellStarts));
    const cellCandidateIndicesPtr = alloc(byteLengthForArray(cellCandidateIndices));
    const lockedMaskPtr = alloc(byteLengthForArray(lockedMask));
    const outCandidatesPtr = alloc(outCandidatesCapacity * outSolutionCapacity * 4);
    const outUsedBySolutionPtr = alloc(outSolutionCapacity * 4);
    const outNodesBySolutionPtr = alloc(outSolutionCapacity * 4);
    const outSolutionCountPtr = alloc(4);
    const outNodesPtr = alloc(4);

    writeI32(exports.memory, pieceInventoryPtr, pieceInventory);
    writeI32(exports.memory, candidatePieceTypesPtr, candidatePieceTypes);
    writeU32(exports.memory, candidateMasksPtr, candidateMasks);
    writeI32(exports.memory, cellStartsPtr, cellStarts);
    writeI32(exports.memory, cellCandidateIndicesPtr, cellCandidateIndices);
    writeU32(exports.memory, lockedMaskPtr, lockedMask);
    writeI32(exports.memory, outUsedBySolutionPtr, new Int32Array(outSolutionCapacity));
    writeI32(exports.memory, outNodesBySolutionPtr, new Int32Array(outSolutionCapacity));
    writeI32(exports.memory, outSolutionCountPtr, new Int32Array([0]));
    writeI32(exports.memory, outNodesPtr, new Int32Array([0]));

    const statusCode = solverSearch(
      pieceInventoryPtr,
      pieceInventory.length,
      candidatePieceTypesPtr,
      candidateMasksPtr,
      candidatePieceTypes.length,
      prepared.wordCount,
      cellStartsPtr,
      cellCandidateIndicesPtr,
      prepared.boardCellCount,
      lockedMaskPtr,
      Math.max(0, Math.trunc(maxNodeExpansions)),
      Math.max(0, Math.trunc(maxWallClockMs)),
      outCandidatesPtr,
      outCandidatesCapacity,
      outUsedBySolutionPtr,
      outNodesBySolutionPtr,
      outSolutionCapacity,
      outSolutionCountPtr,
      outNodesPtr,
    );

    const solutionCount = Math.max(0, readI32Value(exports.memory, outSolutionCountPtr));
    const usedBySolution = new Int32Array(
      exports.memory.buffer,
      outUsedBySolutionPtr,
      outSolutionCapacity,
    ).slice();
    const nodesBySolution = new Int32Array(
      exports.memory.buffer,
      outNodesBySolutionPtr,
      outSolutionCapacity,
    ).slice();
    const nodeExpansions = Math.max(0, readI32Value(exports.memory, outNodesPtr));
    const solutions: { foundAtNode: number; candidateIndices: Int32Array }[] = [];
    for (let index = 0; index < solutionCount; index += 1) {
      const usedCandidateCount = Math.max(0, usedBySolution[index] ?? 0);
      const slotPtr = outCandidatesPtr + index * outCandidatesCapacity * 4;
      solutions.push({
        foundAtNode: Math.max(0, nodesBySolution[index] ?? 0),
        candidateIndices: new Int32Array(
          exports.memory.buffer,
          slotPtr,
          usedCandidateCount,
        ).slice(),
      });
    }
    return { statusCode, nodeExpansions, solutions };
  } finally {
    for (const ptr of ptrs.reverse()) {
      solverFree(ptr);
    }
  }
}
