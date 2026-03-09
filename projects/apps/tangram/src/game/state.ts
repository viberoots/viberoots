import { BOARD_SIZE } from "./board";
import type { GameState } from "./types";

export function createInitialGameState(): GameState {
  return {
    board: {
      size: BOARD_SIZE,
      placedPieces: [],
    },
    pieceCatalog: [],
  };
}
