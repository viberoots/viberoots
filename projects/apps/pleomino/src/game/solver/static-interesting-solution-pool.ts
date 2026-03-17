import { BOARD_COLUMNS, BOARD_ROWS, PIECE_TYPE_INITIAL_SUPPLY } from "../board";
import { PLEOMINO_PIECE_CATALOG } from "../piece-catalog";
import { mixSeed32, normalizeSeed } from "./seeded-random";
import {
  STATIC_INTERESTING_SOLUTIONS,
  type StaticInterestingSolution,
} from "./static-interesting-solutions";
import type { SolverRequest } from "./solver-types";

const MAX_INTERESTINGNESS_THRESHOLD = 1;
const MAX_INTERESTINGNESS_EPSILON = 1e-9;

const CANONICAL_PIECE_KEYS = new Set(PLEOMINO_PIECE_CATALOG.map(pieceKey));

function pieceKey(piece: {
  pieceId: string;
  baseCells: readonly { x: number; y: number }[];
}): string {
  const cells = piece.baseCells
    .map((cell) => `${cell.x},${cell.y}`)
    .sort()
    .join("|");
  return `${piece.pieceId}:${cells}`;
}

function isCanonicalPieceCatalog(request: SolverRequest): boolean {
  if (request.pieceCatalog.length !== PLEOMINO_PIECE_CATALOG.length) {
    return false;
  }
  for (const piece of request.pieceCatalog) {
    if (!CANONICAL_PIECE_KEYS.has(pieceKey(piece))) {
      return false;
    }
  }
  return true;
}

function hasCanonicalInventory(request: SolverRequest): boolean {
  for (const piece of PLEOMINO_PIECE_CATALOG) {
    if ((request.remainingInventory[piece.pieceId] ?? 0) !== PIECE_TYPE_INITIAL_SUPPLY) {
      return false;
    }
  }
  return true;
}

function isCanonicalEmptyBoardRequest(request: SolverRequest): boolean {
  return (
    request.boardSize.columns === BOARD_COLUMNS &&
    request.boardSize.rows === BOARD_ROWS &&
    request.lockedPlacements.length === 0 &&
    isCanonicalPieceCatalog(request) &&
    hasCanonicalInventory(request)
  );
}

export function shouldUseStaticInterestingPool(
  request: SolverRequest,
  interestingnessThreshold: number,
): boolean {
  return (
    STATIC_INTERESTING_SOLUTIONS.length > 0 &&
    interestingnessThreshold >= MAX_INTERESTINGNESS_THRESHOLD - MAX_INTERESTINGNESS_EPSILON &&
    isCanonicalEmptyBoardRequest(request)
  );
}

export function selectStaticInterestingSolution(
  request: SolverRequest,
): StaticInterestingSolution | undefined {
  if (STATIC_INTERESTING_SOLUTIONS.length === 0) {
    return undefined;
  }
  if (request.randomSeed === undefined) {
    return STATIC_INTERESTING_SOLUTIONS[0];
  }
  const index = mixSeed32(normalizeSeed(request.randomSeed)) % STATIC_INTERESTING_SOLUTIONS.length;
  return STATIC_INTERESTING_SOLUTIONS[index];
}
