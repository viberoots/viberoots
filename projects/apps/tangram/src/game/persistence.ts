import { PIECE_TYPE_INITIAL_SUPPLY } from "./board";
import { transformCells, translateCells } from "./geometry";
import { isPlacementValid } from "./placement";
import { DEFAULT_PIECE_TRANSFORM } from "./piece-transform";
import type { Cell, GameState, PieceTransform, PlacedPiece } from "./types";

const PERSISTENCE_SCHEMA_VERSION = 1;
const COMPACT_PERSISTENCE_SCHEMA_VERSION = 3;
const LEGACY_COMPACT_PERSISTENCE_SCHEMA_VERSION = 2;
export const TANGRAM_URL_STATE_HASH_KEY = "s";

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

function parsePlacedPieces(payloadPieces: unknown[], baseline: GameState): PlacedPiece[] | null {
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

function serializePersistedGameState(state: GameState): string {
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
  return JSON.stringify(payload);
}

const ROTATIONS: readonly PieceTransform["rotation"][] = [0, 90, 180, 270];

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(base64url: string): string {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (padded.length % 4)) % 4;
  return `${padded}${"=".repeat(paddingLength)}`;
}

function encodeBytesBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return toBase64Url(Buffer.from(bytes).toString("base64"));
  }

  if (typeof btoa === "undefined") {
    throw new Error("Missing base64 primitives for URL state encoding");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return toBase64Url(btoa(binary));
}

function decodeBase64UrlBytes(value: string): Uint8Array | null {
  try {
    const base64 = fromBase64Url(value);
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(base64, "base64"));
    }
    if (typeof atob === "undefined") {
      return null;
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function encodeUtf8Base64Url(value: string): string {
  if (typeof Buffer !== "undefined") {
    return toBase64Url(Buffer.from(value, "utf8").toString("base64"));
  }

  if (typeof TextEncoder === "undefined" || typeof btoa === "undefined") {
    throw new Error("Missing UTF-8/base64 primitives for URL state encoding");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return toBase64Url(btoa(binary));
}

function decodeUtf8Base64Url(value: string): string | null {
  try {
    const base64 = fromBase64Url(value);
    if (typeof Buffer !== "undefined") {
      return Buffer.from(base64, "base64").toString("utf8");
    }

    if (typeof TextDecoder === "undefined" || typeof atob === "undefined") {
      return null;
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function decodeHashStateToken(hash: string): string | null {
  const search = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return search.get(TANGRAM_URL_STATE_HASH_KEY);
}

function encodeCompactStateToken(state: GameState): string | null {
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
    const compactTransform = rotationIndex | ((transform.flipped ? 1 : 0) << 2);
    transformBits |= compactTransform << (index * 3);
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

function decodeCompactStateToken(token: string, baseline: GameState): GameState | null {
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
    const rotationIndex = (compactValue >> 3) & 0b11;
    const flipped = ((compactValue >> 5) & 0b1) === 1;
    const x = (compactValue >> 6) & 0b1111;
    const y = (compactValue >> 10) & 0b1111;
    if (pieceIndex >= baseline.pieceCatalog.length) {
      return null;
    }
    const pieceId = baseline.pieceCatalog[pieceIndex]?.pieceId;
    if (!pieceId) {
      return null;
    }
    payloadPieces.push({
      instanceId: `${pieceId}#${index}`,
      pieceId,
      transform: { rotation: ROTATIONS[rotationIndex] ?? 0, flipped },
      position: { x, y },
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
    board: {
      ...baseline.board,
      placedPieces,
    },
    selectedPieceId,
    selectedInstanceId,
    transformByPieceId,
    nextPlacedInstanceId: deriveNextPlacedInstanceId(placedPieces, placedPieces.length),
  };
}

function decodeLegacyHashState(hashToken: string): string | null {
  const decodedBase64 = decodeUtf8Base64Url(hashToken);
  if (decodedBase64 !== null) {
    return decodedBase64;
  }
  try {
    return decodeURIComponent(hashToken);
  } catch {
    return null;
  }
}

export function restorePersistedGameState(raw: string, baseline: GameState): GameState | null {
  const payload = parsePersistedPayload(raw);
  if (!payload) {
    return null;
  }

  const transformByPieceId = sanitizeTransformByPieceId(payload.transformByPieceId, baseline);
  const placedPieces = parsePlacedPieces(payload.board.placedPieces, baseline);
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

export function loadPersistedGameStateFromHash(
  location: Pick<Location, "hash">,
  baseline: GameState,
): GameState | null {
  const token = decodeHashStateToken(location.hash);
  if (!token) {
    return null;
  }
  const compactRestored = decodeCompactStateToken(token, baseline);
  if (compactRestored) {
    return compactRestored;
  }
  const legacyRaw = decodeLegacyHashState(token);
  if (!legacyRaw) {
    return null;
  }
  return restorePersistedGameState(legacyRaw, baseline);
}

export function savePersistedGameStateToHash(
  history: Pick<History, "replaceState">,
  location: Pick<Location, "pathname" | "search" | "hash">,
  state: GameState,
): void {
  const token =
    encodeCompactStateToken(state) ?? encodeUtf8Base64Url(serializePersistedGameState(state));
  const nextHash = `#${new URLSearchParams([[TANGRAM_URL_STATE_HASH_KEY, token]]).toString()}`;
  if (location.hash === nextHash) {
    return;
  }
  history.replaceState(null, "", `${location.pathname}${location.search}${nextHash}`);
}

export function clearPersistedGameStateFromHash(
  history: Pick<History, "replaceState">,
  location: Pick<Location, "pathname" | "search">,
): void {
  history.replaceState(null, "", `${location.pathname}${location.search}`);
}
