import { describe, expect, it } from "vitest";
import {
  restorePersistedGameState,
  TANGRAM_PERSISTENCE_STORAGE_KEY,
} from "../src/game/persistence.ts";
import { createInitialGameState } from "../src/game/state.ts";

describe("game persistence", () => {
  it("restores valid persisted state", () => {
    const baseline = createInitialGameState();
    const payload = {
      version: 1,
      board: {
        placedPieces: [
          {
            instanceId: "purple-2-1#3",
            pieceId: "purple-2-1",
            transform: { rotation: 90, flipped: false },
            position: { x: 2, y: 3 },
            isPlaced: true,
          },
        ],
      },
      selectedPieceId: "purple-2-1",
      selectedInstanceId: "purple-2-1#3",
      previewByPieceId: {
        "purple-2-1": { x: 4, y: 5 },
      },
      transformByPieceId: {
        "purple-2-1": { rotation: 90, flipped: false },
      },
      nextPlacedInstanceId: 9,
    };

    const restored = restorePersistedGameState(JSON.stringify(payload), baseline);

    expect(restored).not.toBeNull();
    expect(restored?.board.placedPieces.length).toBe(1);
    expect(restored?.selectedPieceId).toBe("purple-2-1");
    expect(restored?.selectedInstanceId).toBe("purple-2-1#3");
    expect(restored?.nextPlacedInstanceId).toBe(9);
  });

  it("rejects corrupt payloads", () => {
    const baseline = createInitialGameState();
    const restored = restorePersistedGameState("not-json", baseline);

    expect(restored).toBeNull();
  });

  it("rejects incompatible/invalid placement payloads", () => {
    const baseline = createInitialGameState();
    const payload = {
      version: 2,
      board: { placedPieces: [] },
      selectedPieceId: null,
      selectedInstanceId: null,
      previewByPieceId: {},
      transformByPieceId: {},
      nextPlacedInstanceId: 0,
    };

    const restored = restorePersistedGameState(JSON.stringify(payload), baseline);
    expect(restored).toBeNull();
  });

  it("exports a stable versioned storage key", () => {
    expect(TANGRAM_PERSISTENCE_STORAGE_KEY).toBe("tangram.game-state.v1");
  });
});
