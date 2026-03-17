import { canonicalCellSignature, transformCells, translateCells } from "../geometry";
import { cellKey } from "../placement";
import type { PieceTransform } from "../types";
import { mixSeed32, normalizeSeed } from "./seeded-random";
import type { SolverCandidate, SolverPreparedInput, SolverRequest } from "./solver-types";

const TRANSFORMS: readonly PieceTransform[] = [
  { rotation: 0, flipped: false },
  { rotation: 90, flipped: false },
  { rotation: 180, flipped: false },
  { rotation: 270, flipped: false },
  { rotation: 0, flipped: true },
  { rotation: 90, flipped: true },
  { rotation: 180, flipped: true },
  { rotation: 270, flipped: true },
];

function toCellIndex(columns: number, x: number, y: number): number {
  return y * columns + x;
}

function uniqueSortedTransforms(
  baseCells: readonly { x: number; y: number }[],
): readonly PieceTransform[] {
  const bySignature = new Map<string, PieceTransform>();
  for (const transform of TRANSFORMS) {
    const signature = canonicalCellSignature(transformCells(baseCells, transform));
    if (!bySignature.has(signature)) {
      bySignature.set(signature, transform);
    }
  }
  return [...bySignature.values()].sort((left, right) => {
    if (left.rotation !== right.rotation) {
      return left.rotation - right.rotation;
    }
    return Number(left.flipped) - Number(right.flipped);
  });
}

function placementMaskWords(cellIndices: readonly number[], wordCount: number): Uint32Array {
  const words = new Uint32Array(wordCount);
  for (const index of cellIndices) {
    const wordIndex = index >>> 5;
    const bitIndex = index & 31;
    words[wordIndex] |= 1 << bitIndex;
  }
  return words;
}

function shuffleInPlace(values: number[], seed: number): void {
  if (values.length <= 1) {
    return;
  }
  let state = normalizeSeed(seed);
  for (let index = values.length - 1; index > 0; index -= 1) {
    state = mixSeed32((state + index + 0x9e3779b9) >>> 0);
    const swapIndex = state % (index + 1);
    const current = values[index];
    values[index] = values[swapIndex] ?? current;
    values[swapIndex] = current;
  }
}

export function buildSolverPreparedInput(request: SolverRequest): SolverPreparedInput {
  const boardCellCount = request.boardSize.columns * request.boardSize.rows;
  const wordCount = Math.ceil(boardCellCount / 32);
  const pieceIds = request.pieceCatalog.map((piece) => piece.pieceId).sort();
  const pieceTypeIndexById = new Map(pieceIds.map((pieceId, index) => [pieceId, index]));
  const pieceById = new Map(request.pieceCatalog.map((piece) => [piece.pieceId, piece]));

  const lockedMask = new Uint32Array(wordCount);
  for (const placement of request.lockedPlacements) {
    const definition = pieceById.get(placement.pieceId);
    if (!definition) {
      continue;
    }
    const cells = translateCells(
      transformCells(definition.baseCells, placement.transform),
      placement.position,
    );
    for (const cell of cells) {
      const index = toCellIndex(request.boardSize.columns, cell.x, cell.y);
      const wordIndex = index >>> 5;
      const bitIndex = index & 31;
      lockedMask[wordIndex] |= 1 << bitIndex;
    }
  }

  const lockedCellKeys = new Set<string>();
  for (let cellIndex = 0; cellIndex < boardCellCount; cellIndex += 1) {
    const wordIndex = cellIndex >>> 5;
    const bitIndex = cellIndex & 31;
    if (((lockedMask[wordIndex] >>> bitIndex) & 1) === 0) {
      continue;
    }
    const x = cellIndex % request.boardSize.columns;
    const y = Math.floor(cellIndex / request.boardSize.columns);
    lockedCellKeys.add(cellKey({ x, y }));
  }

  const pieceInventory = new Int32Array(pieceIds.length);
  for (const pieceId of pieceIds) {
    const pieceIndex = pieceTypeIndexById.get(pieceId);
    if (pieceIndex === undefined) {
      continue;
    }
    pieceInventory[pieceIndex] = Math.max(0, Math.trunc(request.remainingInventory[pieceId] ?? 0));
  }

  const candidates: SolverCandidate[] = [];
  for (const pieceId of pieceIds) {
    const piece = pieceById.get(pieceId);
    const pieceTypeIndex = pieceTypeIndexById.get(pieceId);
    if (!piece || pieceTypeIndex === undefined || pieceInventory[pieceTypeIndex] <= 0) {
      continue;
    }
    const uniqueTransforms = uniqueSortedTransforms(piece.baseCells);
    for (const transform of uniqueTransforms) {
      const transformed = transformCells(piece.baseCells, transform);
      const maxX = Math.max(...transformed.map((cell) => cell.x));
      const maxY = Math.max(...transformed.map((cell) => cell.y));
      const maxOriginX = request.boardSize.columns - maxX - 1;
      const maxOriginY = request.boardSize.rows - maxY - 1;

      for (let originY = 0; originY <= maxOriginY; originY += 1) {
        for (let originX = 0; originX <= maxOriginX; originX += 1) {
          const position = { x: originX, y: originY };
          const boardCells = translateCells(transformed, position);
          if (boardCells.some((cell) => lockedCellKeys.has(cellKey(cell)))) {
            continue;
          }
          const cellIndices = boardCells
            .map((cell) => toCellIndex(request.boardSize.columns, cell.x, cell.y))
            .sort((left, right) => left - right);
          const maskWords = placementMaskWords(cellIndices, wordCount);
          candidates.push({
            candidateIndex: -1,
            pieceId,
            pieceTypeIndex,
            transform,
            position,
            cellIndices,
            maskWords: [...maskWords],
          });
        }
      }
    }
  }

  candidates.sort((left, right) => {
    const leftCell = left.cellIndices[0] ?? -1;
    const rightCell = right.cellIndices[0] ?? -1;
    if (leftCell !== rightCell) {
      return leftCell - rightCell;
    }
    if (left.pieceTypeIndex !== right.pieceTypeIndex) {
      return left.pieceTypeIndex - right.pieceTypeIndex;
    }
    if (left.transform.rotation !== right.transform.rotation) {
      return left.transform.rotation - right.transform.rotation;
    }
    if (left.transform.flipped !== right.transform.flipped) {
      return Number(left.transform.flipped) - Number(right.transform.flipped);
    }
    if (left.position.y !== right.position.y) {
      return left.position.y - right.position.y;
    }
    return left.position.x - right.position.x;
  });

  for (let index = 0; index < candidates.length; index += 1) {
    candidates[index] = { ...candidates[index], candidateIndex: index };
  }

  const candidatePieceTypes = new Int32Array(candidates.length);
  const candidateMasks = new Uint32Array(candidates.length * wordCount);
  const cellBuckets: number[][] = Array.from({ length: boardCellCount }, () => []);

  for (const candidate of candidates) {
    candidatePieceTypes[candidate.candidateIndex] = candidate.pieceTypeIndex;
    for (let wordIndex = 0; wordIndex < wordCount; wordIndex += 1) {
      candidateMasks[candidate.candidateIndex * wordCount + wordIndex] =
        candidate.maskWords[wordIndex] ?? 0;
    }
    for (const cellIndex of candidate.cellIndices) {
      cellBuckets[cellIndex].push(candidate.candidateIndex);
    }
  }

  if (request.randomSeed !== undefined) {
    const baseSeed = normalizeSeed(request.randomSeed);
    for (let cellIndex = 0; cellIndex < cellBuckets.length; cellIndex += 1) {
      const cellSeed = mixSeed32((baseSeed ^ Math.imul((cellIndex + 1) >>> 0, 0x9e3779b9)) >>> 0);
      shuffleInPlace(cellBuckets[cellIndex] ?? [], cellSeed);
    }
  }

  const cellStarts = new Int32Array(boardCellCount + 1);
  let cellCursor = 0;
  for (let cellIndex = 0; cellIndex < boardCellCount; cellIndex += 1) {
    cellStarts[cellIndex] = cellCursor;
    cellCursor += cellBuckets[cellIndex].length;
  }
  cellStarts[boardCellCount] = cellCursor;

  const cellCandidateIndices = new Int32Array(cellCursor);
  let writeCursor = 0;
  for (let cellIndex = 0; cellIndex < boardCellCount; cellIndex += 1) {
    const indices = cellBuckets[cellIndex];
    for (const candidateIndex of indices) {
      cellCandidateIndices[writeCursor] = candidateIndex;
      writeCursor += 1;
    }
  }

  return {
    boardCellCount,
    wordCount,
    pieceIds,
    pieceInventory,
    candidates,
    candidatePieceTypes,
    candidateMasks,
    lockedMask,
    cellStarts,
    cellCandidateIndices,
  };
}
