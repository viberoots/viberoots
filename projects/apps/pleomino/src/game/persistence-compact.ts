import type { GameState, PieceTransform } from "./types";
import { DEFAULT_PIECE_TRANSFORM } from "./piece-transform";
import { decodeBase64UrlBytes, encodeBytesBase64Url } from "./persistence-codec";
import {
  deriveNextPlacedInstanceId,
  parsePlacedPieces,
  sanitizeTransformByPieceId,
} from "./persistence-state-v1";

const COMPACT_PERSISTENCE_SCHEMA_VERSION = 3;
const LEGACY_COMPACT_PERSISTENCE_SCHEMA_VERSION = 2;

const ROTATIONS: readonly PieceTransform["rotation"][] = [0, 90, 180, 270];

export function encodeCompactStateToken(state: GameState): string | null {
  const pieceIndexById = new Map(state.pieceCatalog.map((piece, index) => [piece.pieceId, index]));
  const selectedPieceIndex =
    state.selectedPieceId === null ? -1 : (pieceIndexById.get(state.selectedPieceId) ?? -1);
  const selectedPlacedIndex =
    state.selectedInstanceId === null
      ? -1
      : state.board.placedPieces.findIndex(
          (piece) => piece.instanceId === state.selectedInstanceId,
        );
  if (
    state.board.placedPieces.length > 255 ||
    selectedPieceIndex > 254 ||
    selectedPlacedIndex > 254
  ) {
    return null;
  }

  let transformBits = 0;
  for (let index = 0; index < state.pieceCatalog.length; index += 1) {
    const pieceId = state.pieceCatalog[index]?.pieceId;
    if (!pieceId || index > 7) {
      return null;
    }
    const transform = state.transformByPieceId[pieceId] ?? DEFAULT_PIECE_TRANSFORM;
    const rotationIndex = ROTATIONS.indexOf(transform.rotation);
    if (rotationIndex < 0) {
      return null;
    }
    transformBits |= (rotationIndex | ((transform.flipped ? 1 : 0) << 2)) << (index * 3);
  }

  const bytes = new Uint8Array(7 + state.board.placedPieces.length * 2);
  bytes[0] = COMPACT_PERSISTENCE_SCHEMA_VERSION;
  bytes[1] = state.board.placedPieces.length;
  bytes[2] = selectedPieceIndex + 1;
  bytes[3] = selectedPlacedIndex + 1;
  bytes[4] = transformBits & 0xff;
  bytes[5] = (transformBits >>> 8) & 0xff;
  bytes[6] = (transformBits >>> 16) & 0xff;

  let offset = 7;
  for (const placedPiece of state.board.placedPieces) {
    const pieceIndex = pieceIndexById.get(placedPiece.pieceId);
    const rotationIndex = ROTATIONS.indexOf(placedPiece.transform.rotation);
    const x = Math.trunc(placedPiece.position.x);
    const y = Math.trunc(placedPiece.position.y);
    if (
      pieceIndex === undefined ||
      pieceIndex > 7 ||
      rotationIndex < 0 ||
      x < 0 ||
      x > 15 ||
      y < 0 ||
      y > 15
    ) {
      return null;
    }
    const compactValue =
      pieceIndex |
      (rotationIndex << 3) |
      ((placedPiece.transform.flipped ? 1 : 0) << 5) |
      (x << 6) |
      (y << 10);
    bytes[offset] = compactValue & 0xff;
    bytes[offset + 1] = compactValue >>> 8;
    offset += 2;
  }
  return encodeBytesBase64Url(bytes);
}

export function decodeCompactStateToken(token: string, baseline: GameState): GameState | null {
  const bytes = decodeBase64UrlBytes(token);
  if (!bytes || bytes.length < 4) {
    return null;
  }
  const compactVersion = bytes[0];
  if (
    compactVersion !== COMPACT_PERSISTENCE_SCHEMA_VERSION &&
    compactVersion !== LEGACY_COMPACT_PERSISTENCE_SCHEMA_VERSION
  ) {
    return null;
  }
  const placedCount = bytes[1];
  const headerSize = compactVersion === COMPACT_PERSISTENCE_SCHEMA_VERSION ? 7 : 4;
  const expectedLength = headerSize + placedCount * 2;
  if (bytes.length !== expectedLength) {
    return null;
  }

  const selectedPieceIndex = bytes[2] - 1;
  const selectedPlacedIndex = bytes[3] - 1;
  if (
    selectedPieceIndex >= baseline.pieceCatalog.length ||
    selectedPlacedIndex >= placedCount ||
    (selectedPieceIndex < -1 && bytes[2] !== 0) ||
    (selectedPlacedIndex < -1 && bytes[3] !== 0)
  ) {
    return null;
  }

  const payloadPieces: unknown[] = [];
  let offset = headerSize;
  for (let index = 0; index < placedCount; index += 1) {
    const compactValue = bytes[offset] | (bytes[offset + 1] << 8);
    const pieceIndex = compactValue & 0b111;
    const pieceId = baseline.pieceCatalog[pieceIndex]?.pieceId;
    if (!pieceId) {
      return null;
    }
    payloadPieces.push({
      instanceId: `${pieceId}#${index}`,
      pieceId,
      transform: {
        rotation: ROTATIONS[(compactValue >> 3) & 0b11] ?? 0,
        flipped: ((compactValue >> 5) & 0b1) === 1,
      },
      position: {
        x: (compactValue >> 6) & 0b1111,
        y: (compactValue >> 10) & 0b1111,
      },
      isPlaced: true,
    });
    offset += 2;
  }

  const placedPieces = parsePlacedPieces(payloadPieces, baseline);
  if (!placedPieces) {
    return null;
  }
  const selectedPieceId =
    selectedPieceIndex >= 0 ? (baseline.pieceCatalog[selectedPieceIndex]?.pieceId ?? null) : null;
  const selectedInstanceId =
    selectedPlacedIndex >= 0 ? (placedPieces[selectedPlacedIndex]?.instanceId ?? null) : null;

  const transformByPieceId = sanitizeTransformByPieceId({}, baseline);
  if (compactVersion === COMPACT_PERSISTENCE_SCHEMA_VERSION) {
    const packedTransforms = (bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8) | ((bytes[6] ?? 0) << 16);
    for (let index = 0; index < baseline.pieceCatalog.length; index += 1) {
      const pieceId = baseline.pieceCatalog[index]?.pieceId;
      if (!pieceId || index > 7) {
        return null;
      }
      const transformValue = (packedTransforms >>> (index * 3)) & 0b111;
      transformByPieceId[pieceId] = {
        rotation: ROTATIONS[transformValue & 0b11] ?? 0,
        flipped: (transformValue & 0b100) !== 0,
      };
    }
  }

  return {
    ...baseline,
    board: { ...baseline.board, placedPieces },
    selectedPieceId,
    selectedInstanceId,
    transformByPieceId,
    nextPlacedInstanceId: deriveNextPlacedInstanceId(placedPieces, placedPieces.length),
  };
}
