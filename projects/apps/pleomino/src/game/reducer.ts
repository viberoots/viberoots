import {
  reduceFlipPiece,
  reducePreviewPiece,
  reduceResetBoard,
  reduceRevertPiece,
  reduceRotatePiece,
  reduceSelectPiece,
} from "./reducer-actions";
import { reduceCommitPiece } from "./reducer-commit";
import type { Cell, GameState } from "./types";

export type GameAction =
  | { type: "state/replace"; state: GameState }
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

export function pleominoGameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "state/replace":
      return action.state;
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
