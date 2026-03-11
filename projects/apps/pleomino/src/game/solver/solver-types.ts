import type { BoardSize, Cell, PieceDefinition, PieceTransform, PlacedPiece } from "../types";

export type SolverInventory = Record<string, number>;

export type SolverRequest = {
  boardSize: BoardSize;
  pieceCatalog: readonly PieceDefinition[];
  lockedPlacements: readonly PlacedPiece[];
  remainingInventory: SolverInventory;
  maxNodeExpansions: number;
  maxWallClockMs: number;
  solutionPoolSize?: number;
  randomSeed?: number;
  selectionWindowSize?: number;
};

export type SolverPlacement = {
  pieceId: string;
  transform: PieceTransform;
  position: Cell;
};

export type SolverStatus = "solved" | "unsolved";

export type SolverResult = {
  status: SolverStatus;
  placements: readonly SolverPlacement[];
  nodeExpansions: number;
  elapsedMs: number;
  interestingnessScore: number;
  selectedSignature: string;
};

export type SolverRankedCandidate = {
  placements: readonly SolverPlacement[];
  interestingnessScore: number;
  foundAtNode: number;
  signature: string;
};

export type SolverCandidate = {
  candidateIndex: number;
  pieceId: string;
  pieceTypeIndex: number;
  transform: PieceTransform;
  position: Cell;
  cellIndices: readonly number[];
  maskWords: readonly number[];
};

export type SolverPreparedInput = {
  boardCellCount: number;
  wordCount: number;
  pieceIds: readonly string[];
  pieceInventory: Int32Array;
  candidates: readonly SolverCandidate[];
  candidatePieceTypes: Int32Array;
  candidateMasks: Uint32Array;
  lockedMask: Uint32Array;
  cellStarts: Int32Array;
  cellCandidateIndices: Int32Array;
};
