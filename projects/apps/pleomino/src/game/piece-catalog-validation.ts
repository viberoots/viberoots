import { canonicalCellSignature } from "./geometry";
import { cellKey } from "./placement";
import type { PieceDefinition } from "./types";

export type PieceCatalogMetadata = {
  pieceCount: number;
  pieceIds: string[];
  colorTokens: string[];
  canonicalSignatures: Record<string, string>;
};

function assertCatalogHasEntries(pieceCatalog: readonly PieceDefinition[]): void {
  if (pieceCatalog.length === 0) {
    throw new Error("piece catalog must include at least one piece");
  }
}

function assertPieceFields(piece: PieceDefinition): void {
  if (piece.pieceId.trim() === "") {
    throw new Error("pieceId must be a non-empty string");
  }
  if (piece.color.trim() === "") {
    throw new Error(`piece ${piece.pieceId} must include a color token`);
  }
  if (piece.baseCells.length === 0) {
    throw new Error(`piece ${piece.pieceId} must include at least one cell`);
  }
}

function assertPieceCells(piece: PieceDefinition): void {
  const seenCells = new Set<string>();
  for (const cell of piece.baseCells) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
      throw new Error(
        `piece ${piece.pieceId} has non-integer cell coordinate (${cell.x},${cell.y})`,
      );
    }
    const key = cellKey(cell);
    if (seenCells.has(key)) {
      throw new Error(`piece ${piece.pieceId} has duplicate cell coordinate ${key}`);
    }
    seenCells.add(key);
  }
}

export function validatePieceCatalog(
  pieceCatalog: readonly PieceDefinition[],
): PieceCatalogMetadata {
  assertCatalogHasEntries(pieceCatalog);
  const seenPieceIds = new Set<string>();
  const seenSignatures = new Map<string, string>();
  const canonicalSignatures: Record<string, string> = {};

  for (const piece of pieceCatalog) {
    assertPieceFields(piece);
    if (seenPieceIds.has(piece.pieceId)) {
      throw new Error(`piece catalog contains duplicate pieceId ${piece.pieceId}`);
    }
    seenPieceIds.add(piece.pieceId);
    assertPieceCells(piece);
    const signature = canonicalCellSignature(piece.baseCells);
    if (seenSignatures.has(signature)) {
      const existing = seenSignatures.get(signature);
      throw new Error(
        `piece ${piece.pieceId} duplicates canonical shape of ${existing} (${signature})`,
      );
    }
    seenSignatures.set(signature, piece.pieceId);
    canonicalSignatures[piece.pieceId] = signature;
  }

  return {
    pieceCount: pieceCatalog.length,
    pieceIds: pieceCatalog.map((piece) => piece.pieceId),
    colorTokens: pieceCatalog.map((piece) => piece.color),
    canonicalSignatures,
  };
}
