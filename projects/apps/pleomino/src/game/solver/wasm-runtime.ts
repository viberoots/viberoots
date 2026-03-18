import type { SolverPreparedInput } from "./solver-types";
import { byteLengthForArray, readI32Value, writeI32, writeU32 } from "./wasm-runtime-memory";
import {
  loadSolverSearchExports,
  prewarmSolverWasmAsset,
  resetSolverWasmForTests,
} from "./wasm-runtime-loader";

export type WasmSearchResult = {
  statusCode: number;
  nodeExpansions: number;
  solutions: readonly {
    foundAtNode: number;
    candidateIndices: Int32Array;
  }[];
};

export { prewarmSolverWasmAsset, resetSolverWasmForTests };

export async function runSolverSearchInWasm(
  prepared: SolverPreparedInput,
  maxNodeExpansions: number,
  maxWallClockMs: number,
  solutionPoolSize: number,
): Promise<WasmSearchResult> {
  const exports = await loadSolverSearchExports();
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
