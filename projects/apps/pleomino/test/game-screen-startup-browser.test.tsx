/** @vitest-environment jsdom */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePersistedGameStateToHash } from "../src/game/persistence";
import { createInitialGameState } from "../src/game/state";
import { GameScreen } from "../src/ui/game-screen";

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(assertion: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) {
      return;
    }
    await flushUi();
  }
  throw new Error("timed out waiting for condition");
}

describe("game screen startup browser", () => {
  let appRoot: HTMLDivElement | null = null;
  let root: Root | null = null;
  let queuedAnimationFrames: Array<FrameRequestCallback | null> = [];

  beforeEach(() => {
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    queuedAnimationFrames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(
      (callback: FrameRequestCallback) => {
        queuedAnimationFrames.push(callback);
        return queuedAnimationFrames.length;
      },
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId: number) => {
      queuedAnimationFrames[frameId - 1] = null;
    });
    appRoot = document.createElement("div");
    appRoot.id = "app";
    appRoot.setAttribute("data-ui-ready", "true");
    document.body.appendChild(appRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (root) {
      root.unmount();
      root = null;
    }
    if (appRoot) {
      appRoot.remove();
      appRoot = null;
    }
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    await flushUi();
  });

  function runNextAnimationFrame() {
    const callback = queuedAnimationFrames.shift();
    callback?.(performance.now());
  }

  it("reveals only after restored state is rendered and two animation frames complete", async () => {
    const seededState = createInitialGameState();
    seededState.board.placedPieces = [
      {
        instanceId: "purple-2-1#1",
        pieceId: "purple-2-1",
        transform: { rotation: 0, flipped: false },
        position: { x: 0, y: 0 },
        isPlaced: true,
      },
    ];
    savePersistedGameStateToHash(window.history, window.location, seededState);

    if (!appRoot) {
      throw new Error("expected app root");
    }
    root = createRoot(appRoot);
    root.render(<GameScreen url="/games/pleomino" />);
    await flushUi();
    await waitFor(() => queuedAnimationFrames.length > 0);

    expect(appRoot.getAttribute("data-ui-ready")).toBe("false");
    expect(
      appRoot.querySelector('[data-testid="pleomino-board-cell"][style*="background-color"]'),
    ).not.toBeNull();

    runNextAnimationFrame();
    await flushUi();
    expect(appRoot.getAttribute("data-ui-ready")).toBe("false");

    runNextAnimationFrame();
    await flushUi();
    expect(appRoot.getAttribute("data-ui-ready")).toBe("true");
  });
});
