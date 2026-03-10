import { describe, expect, it } from "vitest";
import {
  clearPersistedGameStateFromHash,
  loadPersistedGameStateFromHash,
  restorePersistedGameState,
  savePersistedGameStateToHash,
  TANGRAM_URL_STATE_HASH_KEY,
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

  it("keeps tray transform canonical even when restored placed instance has rotation", () => {
    const baseline = createInitialGameState();
    const payload = {
      version: 1,
      board: {
        placedPieces: [
          {
            instanceId: "purple-2-1#3",
            pieceId: "purple-2-1",
            transform: { rotation: 90, flipped: true },
            position: { x: 2, y: 3 },
            isPlaced: true,
          },
        ],
      },
      selectedPieceId: "purple-2-1",
      selectedInstanceId: "purple-2-1#3",
      previewByPieceId: { "purple-2-1": null },
      transformByPieceId: {},
      nextPlacedInstanceId: 4,
    };

    const restored = restorePersistedGameState(JSON.stringify(payload), baseline);

    expect(restored?.transformByPieceId["purple-2-1"]).toEqual({ rotation: 0, flipped: false });
    expect(restored?.board.placedPieces[0]?.transform).toEqual({ rotation: 90, flipped: true });
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

  it("exports a stable hash key", () => {
    expect(TANGRAM_URL_STATE_HASH_KEY).toBe("s");
  });

  it("round-trips state through URL hash persistence", () => {
    const baseline = createInitialGameState();
    const committed = {
      ...baseline,
      board: {
        ...baseline.board,
        placedPieces: [
          {
            instanceId: "purple-2-1#1",
            pieceId: "purple-2-1",
            transform: { rotation: 0, flipped: false },
            position: { x: 1, y: 2 },
            isPlaced: true,
          },
        ],
      },
    };
    let url = "/games/tangram";
    const history = {
      replaceState(_state: unknown, _title: string, nextUrl: string) {
        url = nextUrl;
      },
    };
    const location = {
      pathname: "/games/tangram",
      search: "",
      hash: "",
    };

    savePersistedGameStateToHash(history, location, committed);
    const hash = url.split("#")[1] ?? "";
    const restored = loadPersistedGameStateFromHash({ hash: hash ? `#${hash}` : "" }, baseline);
    const encoded = new URLSearchParams(hash).get(TANGRAM_URL_STATE_HASH_KEY);

    expect(restored?.board.placedPieces.length).toBe(1);
    expect(restored?.board.placedPieces[0]?.position).toEqual({ x: 1, y: 2 });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect((encoded ?? "").length).toBeLessThan(JSON.stringify(committed).length);
  });

  it("clears persisted state hash", () => {
    let url = "/games/tangram#s=abc";
    const history = {
      replaceState(_state: unknown, _title: string, nextUrl: string) {
        url = nextUrl;
      },
    };
    clearPersistedGameStateFromHash(history, { pathname: "/games/tangram", search: "" });
    expect(url).toBe("/games/tangram");
  });
});
