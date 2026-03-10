import { PIECE_TYPE_INITIAL_SUPPLY } from "./board";
import { transformCells, translateCells } from "./geometry";
import { isPlacementValid } from "./placement";
import { DEFAULT_PIECE_TRANSFORM } from "./piece-transform";
import type { Cell, GameState, PieceTransform, PlacedPiece } from "./types";

export const TANGRAM_PERSISTENCE_STORAGE_KEY = "tangram.game-state.v1";
const PERSISTENCE_SCHEMA_VERSION = 1;

type PersistedGameStateV1 = {
  version: 1;
  board: { placedPieces: unknown[] };
  selectedPieceId: unknown;
  selectedInstanceId: unknown;
  previewByPieceId: Record<string, unknown>;
  transformByPieceId: Record<string, unknown>;
  nextPlacedInstanceId: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const next = Math.trunc(value);
  return next === value ? next : null;
}

function parseCell(value: unknown): Cell | null {
  const objectValue = asObject(value);
  if (!objectValue) {
    return null;
  }
  const x = parseInteger(objectValue.x);
  const y = parseInteger(objectValue.y);
  return x === null || y === null ? null : { x, y };
}

function parseTransform(value: unknown): PieceTransform | null {
  const objectValue = asObject(value);
  if (!objectValue || typeof objectValue.flipped !== "boolean") {
    return null;
  }
  const rotation = parseInteger(objectValue.rotation);
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    return null;
  }
  return {
    rotation,
    flipped: objectValue.flipped,
  };
}

function parsePersistedPayload(raw: string): PersistedGameStateV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const objectValue = asObject(parsed);
    if (!objectValue || objectValue.version !== PERSISTENCE_SCHEMA_VERSION) {
      return null;
    }
    const board = asObject(objectValue.board);
    const previewByPieceId = asObject(objectValue.previewByPieceId);
    const transformByPieceId = asObject(objectValue.transformByPieceId);
    if (!board || !Array.isArray(board.placedPieces) || !previewByPieceId || !transformByPieceId) {
      return null;
    }
    return {
      version: 1,
      board: { placedPieces: board.placedPieces },
      selectedPieceId: objectValue.selectedPieceId,
      selectedInstanceId: objectValue.selectedInstanceId,
      previewByPieceId,
      transformByPieceId,
      nextPlacedInstanceId: objectValue.nextPlacedInstanceId,
    };
  } catch {
    return null;
  }
}

function parsePlacedPieces(
  payloadPieces: unknown[],
  baseline: GameState,
  transformByPieceId: Record<string, PieceTransform>,
): PlacedPiece[] | null {
  const pieceById = new Map(baseline.pieceCatalog.map((piece) => [piece.pieceId, piece]));
  const occupied = new Set<string>();
  const byPieceType = new Map<string, number>();
  const seenIds = new Set<string>();
  const placedPieces: PlacedPiece[] = [];

  for (const item of payloadPieces) {
    const objectValue = asObject(item);
    if (!objectValue) {
      return null;
    }
    const instanceId = typeof objectValue.instanceId === "string" ? objectValue.instanceId : null;
    const pieceId = typeof objectValue.pieceId === "string" ? objectValue.pieceId : null;
    const position = parseCell(objectValue.position);
    const transform = parseTransform(objectValue.transform);
    if (!instanceId || !pieceId || !position || !transform || seenIds.has(instanceId)) {
      return null;
    }
    const definition = pieceById.get(pieceId);
    if (!definition) {
      return null;
    }
    const pieceCount = (byPieceType.get(pieceId) ?? 0) + 1;
    if (pieceCount > PIECE_TYPE_INITIAL_SUPPLY) {
      return null;
    }
    const boardCells = translateCells(transformCells(definition.baseCells, transform), position);
    if (!isPlacementValid(baseline.board.size, occupied, boardCells)) {
      return null;
    }
    for (const cell of boardCells) {
      occupied.add(`${cell.x},${cell.y}`);
    }
    seenIds.add(instanceId);
    byPieceType.set(pieceId, pieceCount);
    placedPieces.push({
      instanceId,
      pieceId,
      transform,
      position,
      isPlaced: true,
    });
    transformByPieceId[pieceId] = transform;
  }

  return placedPieces;
}

function deriveNextPlacedInstanceId(
  placedPieces: readonly PlacedPiece[],
  fallback: number,
): number {
  let maxIndex = -1;
  for (const piece of placedPieces) {
    const match = /#(\d+)$/.exec(piece.instanceId);
    if (!match) {
      continue;
    }
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > maxIndex) {
      maxIndex = parsed;
    }
  }
  return Math.max(fallback, maxIndex + 1);
}

function sanitizePreviewByPieceId(
  payload: Record<string, unknown>,
  baseline: GameState,
): Record<string, Cell | null> {
  const previewByPieceId: Record<string, Cell | null> = {};
  for (const piece of baseline.pieceCatalog) {
    const rawValue = payload[piece.pieceId];
    previewByPieceId[piece.pieceId] = rawValue === null ? null : parseCell(rawValue);
  }
  return previewByPieceId;
}

function sanitizeTransformByPieceId(
  payload: Record<string, unknown>,
  baseline: GameState,
): Record<string, PieceTransform> {
  const transformByPieceId: Record<string, PieceTransform> = {};
  for (const piece of baseline.pieceCatalog) {
    transformByPieceId[piece.pieceId] =
      parseTransform(payload[piece.pieceId]) ?? DEFAULT_PIECE_TRANSFORM;
  }
  return transformByPieceId;
}

export function restorePersistedGameState(raw: string, baseline: GameState): GameState | null {
  const payload = parsePersistedPayload(raw);
  if (!payload) {
    return null;
  }

  const transformByPieceId = sanitizeTransformByPieceId(payload.transformByPieceId, baseline);
  const placedPieces = parsePlacedPieces(payload.board.placedPieces, baseline, transformByPieceId);
  if (!placedPieces) {
    return null;
  }

  const selectedPieceId =
    typeof payload.selectedPieceId === "string" && transformByPieceId[payload.selectedPieceId]
      ? payload.selectedPieceId
      : null;
  const selectedInstanceIdCandidate =
    typeof payload.selectedInstanceId === "string" ? payload.selectedInstanceId : null;
  const selectedInstanceId =
    selectedInstanceIdCandidate &&
    placedPieces.some((piece) => piece.instanceId === selectedInstanceIdCandidate)
      ? selectedInstanceIdCandidate
      : null;

  const nextPlacedInstanceIdValue = parseInteger(payload.nextPlacedInstanceId);
  const nextPlacedInstanceId = deriveNextPlacedInstanceId(
    placedPieces,
    nextPlacedInstanceIdValue === null || nextPlacedInstanceIdValue < 0
      ? 0
      : nextPlacedInstanceIdValue,
  );

  return {
    ...baseline,
    board: {
      ...baseline.board,
      placedPieces,
    },
    selectedPieceId,
    selectedInstanceId,
    previewByPieceId: sanitizePreviewByPieceId(payload.previewByPieceId, baseline),
    transformByPieceId,
    nextPlacedInstanceId,
  };
}

export function loadPersistedGameState(
  storage: Pick<Storage, "getItem">,
  baseline: GameState,
): GameState | null {
  const raw = storage.getItem(TANGRAM_PERSISTENCE_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  return restorePersistedGameState(raw, baseline);
}

export function savePersistedGameState(storage: Pick<Storage, "setItem">, state: GameState): void {
  const payload: PersistedGameStateV1 = {
    version: 1,
    board: {
      placedPieces: state.board.placedPieces,
    },
    selectedPieceId: state.selectedPieceId,
    selectedInstanceId: state.selectedInstanceId,
    previewByPieceId: state.previewByPieceId,
    transformByPieceId: state.transformByPieceId,
    nextPlacedInstanceId: state.nextPlacedInstanceId,
  };
  storage.setItem(TANGRAM_PERSISTENCE_STORAGE_KEY, JSON.stringify(payload));
}

export function clearPersistedGameState(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(TANGRAM_PERSISTENCE_STORAGE_KEY);
}
