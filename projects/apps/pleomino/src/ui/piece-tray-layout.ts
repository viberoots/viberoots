import type { PieceTrayViewModel } from "../game/selectors";
import { pieceBounds } from "./piece-view-helpers";

export const STACKED_COLUMNS = 4;
export const DESKTOP_COLUMN_GAP = 18;
export const STACKED_COLUMN_GAP = 8;
export const BASE_TRAY_HORIZONTAL_PADDING = 12;
export const STACKED_TRAY_HORIZONTAL_PADDING = 8;

export function orderedTrayPieces(
  pieces: readonly PieceTrayViewModel["pieces"][number][],
  isStacked: boolean,
): PieceTrayViewModel["pieces"] {
  const pieceById = new Map(pieces.map((piece) => [piece.pieceId, piece]));
  const orderedIds = isStacked
    ? [
        "purple-2-1",
        "green-2-2",
        "yellow-1-2-1",
        "black-1-1-1-1",
        "red-2-2",
        "blue-3-1",
        "orange-2-1-2",
        "white-1-1",
      ]
    : [
        "purple-2-1",
        "red-2-2",
        "black-1-1-1-1",
        "green-2-2",
        "yellow-1-2-1",
        "blue-3-1",
        "orange-2-1-2",
        "white-1-1",
      ];
  const ordered: PieceTrayViewModel["pieces"] = [];
  for (const pieceId of orderedIds) {
    const piece = pieceById.get(pieceId);
    if (piece) {
      ordered.push(piece);
      pieceById.delete(pieceId);
    }
  }
  for (const piece of pieces) {
    if (pieceById.has(piece.pieceId)) {
      ordered.push(piece);
    }
  }
  return ordered;
}

export function buildBalancedRows(
  pieces: readonly PieceTrayViewModel["pieces"][number][],
  columnCount: number,
): PieceTrayViewModel["pieces"][] {
  if (pieces.length === 0) {
    return [];
  }
  const widthByPieceId = new Map<string, number>();
  for (const piece of pieces) {
    widthByPieceId.set(piece.pieceId, pieceBounds(piece.cells).columns);
  }
  const sortedPieces = [...pieces].sort((left, right) => {
    const leftWidth = widthByPieceId.get(left.pieceId) ?? 0;
    const rightWidth = widthByPieceId.get(right.pieceId) ?? 0;
    if (leftWidth !== rightWidth) {
      return rightWidth - leftWidth;
    }
    return left.pieceId.localeCompare(right.pieceId);
  });
  const rowCount = Math.max(1, Math.ceil(pieces.length / columnCount));
  const rows: PieceTrayViewModel["pieces"][] = Array.from({ length: rowCount }, () => []);
  const rowWidths = Array.from({ length: rowCount }, () => 0);
  for (const piece of sortedPieces) {
    const width = widthByPieceId.get(piece.pieceId) ?? 0;
    let targetRow = -1;
    let bestWidth = Number.POSITIVE_INFINITY;
    let bestLength = Number.POSITIVE_INFINITY;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      if (rows[rowIndex].length >= columnCount) {
        continue;
      }
      const rowWidth = rowWidths[rowIndex];
      if (
        rowWidth < bestWidth ||
        (rowWidth === bestWidth && rows[rowIndex].length < bestLength) ||
        targetRow === -1
      ) {
        targetRow = rowIndex;
        bestWidth = rowWidth;
        bestLength = rows[rowIndex].length;
      }
    }
    if (targetRow === -1) {
      continue;
    }
    rows[targetRow].push(piece);
    rowWidths[targetRow] += width;
  }
  return rows.filter((row) => row.length > 0);
}

export function buildDesktopRows(
  pieces: readonly PieceTrayViewModel["pieces"][number][],
): PieceTrayViewModel["pieces"][] {
  const pieceById = new Map(pieces.map((piece) => [piece.pieceId, piece]));
  const take = (pieceId: string): PieceTrayViewModel["pieces"][number] | null => {
    const piece = pieceById.get(pieceId);
    if (!piece) {
      return null;
    }
    pieceById.delete(pieceId);
    return piece;
  };
  const rows: PieceTrayViewModel["pieces"][] = [];
  const addRow = (pieceIds: readonly string[]) => {
    const row = pieceIds
      .map((pieceId) => take(pieceId))
      .filter((piece) => piece !== null) as PieceTrayViewModel["pieces"];
    if (row.length > 0) {
      rows.push(row);
    }
  };
  const blackPiece = pieceById.get("black-1-1-1-1");
  const blackBounds = blackPiece ? pieceBounds(blackPiece.cells) : null;
  const isBlackVertical = blackBounds !== null ? blackBounds.rows > blackBounds.columns : false;
  addRow(["purple-2-1", "red-2-2"]);
  addRow(isBlackVertical ? ["black-1-1-1-1", "orange-2-1-2"] : ["black-1-1-1-1"]);
  if (!isBlackVertical) {
    addRow(["orange-2-1-2"]);
  }
  addRow(["yellow-1-2-1", "blue-3-1"]);
  addRow(["green-2-2", "white-1-1"]);
  for (const piece of pieces) {
    if (pieceById.has(piece.pieceId)) {
      rows.push([piece]);
      pieceById.delete(piece.pieceId);
    }
  }
  return rows;
}
