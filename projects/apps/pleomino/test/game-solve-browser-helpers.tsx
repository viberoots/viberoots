import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  loadPersistedGameStateFromHash,
  savePersistedGameStateToHash,
} from "../src/game/persistence.ts";
import type { SolverResult } from "../src/game/solver/solver-types.ts";
import { createInitialGameState } from "../src/game/state.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";

export function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function waitFor(assertion: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) {
      return;
    }
    await flushUi();
  }
  throw new Error("timed out waiting for condition");
}

export function readPersisted() {
  return loadPersistedGameStateFromHash(window.location, createInitialGameState());
}

export function currentSolveState(container: HTMLDivElement): string {
  const status = container.querySelector('[data-testid="pleomino-solve-state"]');
  if (!(status instanceof HTMLElement)) {
    throw new Error("expected solve status element");
  }
  return (status.textContent ?? "").trim();
}

export function renderGameScreen(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(<GameScreen url="/games/pleomino" />);
  return { container, root };
}

export function seedSinglePurplePlacement(): void {
  const seeded = createInitialGameState();
  seeded.board.placedPieces = [
    {
      instanceId: "purple-2-1#1",
      pieceId: "purple-2-1",
      transform: { rotation: 0, flipped: false },
      position: { x: 1, y: 1 },
      isPlaced: true,
    },
  ];
  seeded.nextPlacedInstanceId = 2;
  savePersistedGameStateToHash(window.history, window.location, seeded);
}

export function unsolvedResult(): SolverResult {
  return {
    status: "unsolved",
    placements: [],
    nodeExpansions: 10,
    elapsedMs: 1,
    interestingnessScore: 0,
    selectedSignature: "",
  };
}
