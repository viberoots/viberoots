/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import {
  clearPersistedGameStateFromHash,
  loadPersistedGameStateFromHash,
  savePersistedGameStateToHash,
} from "../src/game/persistence.ts";
import { createInitialGameState } from "../src/game/state.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("game screen persistence", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      root.unmount();
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    await flushUi();
  });

  it("restores persisted placement state on startup", async () => {
    const seeded = createInitialGameState();
    seeded.board.placedPieces = [
      {
        instanceId: "purple-2-1#1",
        pieceId: "purple-2-1",
        transform: { rotation: 0, flipped: false },
        position: { x: 0, y: 0 },
        isPlaced: true,
      },
    ];
    seeded.selectedPieceId = "purple-2-1";
    seeded.selectedInstanceId = "purple-2-1#1";
    seeded.nextPlacedInstanceId = 2;
    savePersistedGameStateToHash(window.history, window.location, seeded);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<GameScreen url="/games/tangram" />);
    await flushUi();

    const persisted = loadPersistedGameStateFromHash(window.location, createInitialGameState());
    expect(persisted?.board.placedPieces.length ?? 0).toBe(1);
  });

  it("clear behavior with storage resets startup state to a clean board", async () => {
    const seeded = createInitialGameState();
    seeded.board.placedPieces = [
      {
        instanceId: "purple-2-1#1",
        pieceId: "purple-2-1",
        transform: { rotation: 0, flipped: false },
        position: { x: 0, y: 0 },
        isPlaced: true,
      },
    ];
    seeded.selectedPieceId = "purple-2-1";
    seeded.selectedInstanceId = "purple-2-1#1";
    seeded.nextPlacedInstanceId = 2;
    savePersistedGameStateToHash(window.history, window.location, seeded);
    clearPersistedGameStateFromHash(window.history, window.location);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<GameScreen url="/games/tangram" />);
    await flushUi();
    const persisted = loadPersistedGameStateFromHash(window.location, createInitialGameState());
    expect(persisted?.board.placedPieces.length ?? 0).toBe(0);
  });
});
