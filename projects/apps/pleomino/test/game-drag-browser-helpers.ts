/** @vitest-environment jsdom */
import { createInitialGameState } from "../src/game/state.ts";
import { loadPersistedGameStateFromHash } from "../src/game/persistence.ts";

export type Pointer = { x: number; y: number };

export function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cardByPieceId(pieceId: string): Element {
  const cards = Array.from(document.querySelectorAll('[data-testid="pleomino-piece-view"]'));
  const card = cards.find((candidate) => {
    const label = candidate.getAttribute("aria-label");
    return typeof label === "string" && label.startsWith(`Piece ${pieceId},`);
  });
  if (!card) {
    throw new Error(`expected piece card ${pieceId}`);
  }
  return card;
}

export function tapCard(card: Element, pointer: Pointer) {
  card.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: pointer.x,
      clientY: pointer.y,
    }),
  );
  card.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: pointer.x, clientY: pointer.y }),
  );
  window.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: pointer.x, clientY: pointer.y }),
  );
}

export function persistedState() {
  const restored = loadPersistedGameStateFromHash(window.location, createInitialGameState());
  if (!restored) {
    throw new Error("expected persisted state");
  }
  return restored;
}

export function snapTargetKeys(): string[] {
  return Array.from(document.querySelectorAll('[data-testid="pleomino-board-cell-snap-target"]'))
    .map((cell) => `${cell.getAttribute("data-cell-x")},${cell.getAttribute("data-cell-y")}`)
    .sort();
}

export function parsePx(value: string): number {
  const parsed = Number.parseFloat(value.replace("px", ""));
  if (!Number.isFinite(parsed)) {
    throw new Error(`expected pixel value, got: ${value}`);
  }
  return parsed;
}

export function centeredOffset(containerSize: number, contentSize: number): number {
  return Math.max(0, (containerSize - contentSize) / 2);
}
