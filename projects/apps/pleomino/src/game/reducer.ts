import {
  reduceFlipPiece,
  reducePreviewPiece,
  reduceResetBoard,
  reduceRevertPiece,
  reduceRotatePiece,
  reduceSelectPiece,
} from "./reducer-actions";
import { reduceCommitPiece } from "./reducer-commit";
import type { Cell, GameHistoryState, GameState, PieceTransform } from "./types";

const MAX_HISTORY_ENTRIES = 200;

export type GameAction =
  | { type: "state/replace"; state: GameState }
  | { type: "history/undo" }
  | { type: "history/redo" }
  | {
      type: "solve/apply";
      placements: readonly {
        pieceId: string;
        transform: PieceTransform;
        position: Cell;
      }[];
    }
  | { type: "solve/request" }
  | { type: "piece/select"; pieceId: string; instanceId?: string | null }
  | { type: "piece/preview"; pieceId: string; position: Cell | null }
  | {
      type: "piece/commit";
      pieceId: string;
      sourceInstanceId?: string | null;
      dropOutside?: boolean;
    }
  | { type: "piece/rotate"; pieceId: string; instanceId?: string | null; direction?: "cw" | "ccw" }
  | { type: "piece/flip"; pieceId: string; instanceId?: string | null }
  | { type: "piece/revert"; pieceId: string }
  | { type: "board/reset" };

function isHistoryState(state: GameHistoryState | GameState): state is GameHistoryState {
  return (
    typeof state === "object" &&
    state !== null &&
    "present" in state &&
    "past" in state &&
    "future" in state
  );
}

function placementSignature(placement: {
  pieceId: string;
  transform: PieceTransform;
  position: Cell;
}): string {
  const { pieceId, position, transform } = placement;
  return `${pieceId}|${position.x},${position.y}|${transform.rotation}|${transform.flipped ? "1" : "0"}`;
}

function clearAllPreviews(state: GameState): GameState["previewByPieceId"] {
  const cleared: GameState["previewByPieceId"] = {};
  for (const pieceId of Object.keys(state.previewByPieceId)) {
    cleared[pieceId] = null;
  }
  return cleared;
}

function applySolvedPlacements(
  state: GameState,
  placements: readonly {
    pieceId: string;
    transform: PieceTransform;
    position: Cell;
  }[],
): GameState {
  const validPieceIds = new Set(state.pieceCatalog.map((piece) => piece.pieceId));
  const remainingInstanceIdsBySignature = new Map<string, string[]>();
  for (const placed of state.board.placedPieces) {
    const signature = placementSignature(placed);
    const ids = remainingInstanceIdsBySignature.get(signature) ?? [];
    ids.push(placed.instanceId);
    remainingInstanceIdsBySignature.set(signature, ids);
  }

  let nextPlacedInstanceId = state.nextPlacedInstanceId;
  const nextPlacedPieces: GameState["board"]["placedPieces"] = [];
  for (const placement of placements) {
    if (!validPieceIds.has(placement.pieceId)) {
      continue;
    }
    const signature = placementSignature(placement);
    const reusableIds = remainingInstanceIdsBySignature.get(signature);
    const instanceId = reusableIds?.shift() ?? `${placement.pieceId}#${nextPlacedInstanceId++}`;
    nextPlacedPieces.push({
      instanceId,
      pieceId: placement.pieceId,
      transform: placement.transform,
      position: placement.position,
      isPlaced: true,
    });
  }

  return {
    ...state,
    board: {
      ...state.board,
      placedPieces: nextPlacedPieces,
    },
    selectedPieceId: null,
    selectedInstanceId: null,
    previewByPieceId: clearAllPreviews(state),
    nextPlacedInstanceId,
  };
}

function reducePresentState(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "state/replace":
      return action.state;
    case "history/undo":
    case "history/redo":
    case "solve/request":
      return state;
    case "solve/apply":
      return applySolvedPlacements(state, action.placements);
    case "piece/select":
      return reduceSelectPiece(state, action.pieceId, action.instanceId);
    case "piece/preview":
      return reducePreviewPiece(state, action.pieceId, action.position);
    case "piece/commit":
      return reduceCommitPiece(state, action.pieceId, action.sourceInstanceId, action.dropOutside);
    case "piece/rotate":
      return reduceRotatePiece(state, action.pieceId, action.instanceId, action.direction ?? "cw");
    case "piece/flip":
      return reduceFlipPiece(state, action.pieceId, action.instanceId);
    case "piece/revert":
      return reduceRevertPiece(state, action.pieceId);
    case "board/reset":
      return reduceResetBoard(state);
    default:
      return state;
  }
}

function pushPastSnapshot(past: readonly GameState[], snapshot: GameState): readonly GameState[] {
  const appended = [...past, snapshot];
  if (appended.length <= MAX_HISTORY_ENTRIES) {
    return appended;
  }
  return appended.slice(appended.length - MAX_HISTORY_ENTRIES);
}

function snapshotWithoutPreview(state: GameState): GameState {
  let hasPreview = false;
  const clearedPreview: GameState["previewByPieceId"] = {};
  for (const [pieceId, preview] of Object.entries(state.previewByPieceId)) {
    if (preview !== null) {
      hasPreview = true;
    }
    clearedPreview[pieceId] = null;
  }
  if (!hasPreview) {
    return state;
  }
  return { ...state, previewByPieceId: clearedPreview };
}

function shouldTrackInHistory(action: GameAction): boolean {
  switch (action.type) {
    case "piece/commit":
    case "piece/rotate":
    case "piece/flip":
    case "board/reset":
    case "solve/apply":
      return true;
    default:
      return false;
  }
}

function reduceHistoryState(state: GameHistoryState, action: GameAction): GameHistoryState {
  switch (action.type) {
    case "state/replace":
      return {
        past: [],
        present: action.state,
        future: [],
      };
    case "history/undo": {
      if (state.past.length === 0) {
        return state;
      }
      const previousIndex = state.past.length - 1;
      return {
        past: state.past.slice(0, previousIndex),
        present: state.past[previousIndex] as GameState,
        future: [state.present, ...state.future],
      };
    }
    case "history/redo": {
      if (state.future.length === 0) {
        return state;
      }
      const [nextPresent, ...nextFuture] = state.future;
      return {
        past: pushPastSnapshot(state.past, snapshotWithoutPreview(state.present)),
        present: nextPresent,
        future: nextFuture,
      };
    }
    default: {
      const nextPresent = reducePresentState(state.present, action);
      if (nextPresent === state.present) {
        return state;
      }
      if (!shouldTrackInHistory(action)) {
        return { ...state, present: nextPresent };
      }
      return {
        past: pushPastSnapshot(state.past, snapshotWithoutPreview(state.present)),
        present: nextPresent,
        future: [],
      };
    }
  }
}

export function pleominoGameReducer(state: GameHistoryState, action: GameAction): GameHistoryState;
export function pleominoGameReducer(state: GameState, action: GameAction): GameState;
export function pleominoGameReducer(
  state: GameHistoryState | GameState,
  action: GameAction,
): GameHistoryState | GameState {
  const historyState = isHistoryState(state)
    ? state
    : {
        past: [],
        present: state,
        future: [],
      };
  const nextState = reduceHistoryState(historyState, action);
  if (isHistoryState(state)) {
    return nextState;
  }
  return nextState.present;
}
