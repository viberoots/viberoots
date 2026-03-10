/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { clearPersistedGameState } from "../src/game/persistence.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";
import { TANGRAM_PERSISTENCE_STORAGE_KEY } from "../src/game/persistence.ts";

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
    window.localStorage.clear();
    await flushUi();
  });

  it("restores persisted placement state on startup", async () => {
    window.localStorage.setItem(
      TANGRAM_PERSISTENCE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        board: {
          placedPieces: [
            {
              instanceId: "purple-2-1#1",
              pieceId: "purple-2-1",
              transform: { rotation: 0, flipped: false },
              position: { x: 0, y: 0 },
              isPlaced: true,
            },
          ],
        },
        selectedPieceId: "purple-2-1",
        selectedInstanceId: "purple-2-1#1",
        previewByPieceId: { "purple-2-1": null },
        transformByPieceId: { "purple-2-1": { rotation: 0, flipped: false } },
        nextPlacedInstanceId: 2,
      }),
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<GameScreen url="/games/tangram" />);
    await flushUi();

    expect(document.body.textContent ?? "").toContain("Placed pieces: 1");
  });

  it("clear behavior with storage resets startup state to a clean board", async () => {
    window.localStorage.setItem(
      TANGRAM_PERSISTENCE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        board: {
          placedPieces: [
            {
              instanceId: "purple-2-1#1",
              pieceId: "purple-2-1",
              transform: { rotation: 0, flipped: false },
              position: { x: 0, y: 0 },
              isPlaced: true,
            },
          ],
        },
        selectedPieceId: "purple-2-1",
        selectedInstanceId: "purple-2-1#1",
        previewByPieceId: { "purple-2-1": null },
        transformByPieceId: { "purple-2-1": { rotation: 0, flipped: false } },
        nextPlacedInstanceId: 2,
      }),
    );
    clearPersistedGameState(window.localStorage);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<GameScreen url="/games/tangram" />);
    await flushUi();
    expect(document.body.textContent ?? "").toContain("Placed pieces: 0");
  });
});
