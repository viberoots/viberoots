/** @vitest-environment jsdom */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import solveLatencyBaseline from "./fixtures/solve-interaction-latency-baseline.json";
import { flushUi } from "./game-drag-browser-helpers";
import * as solverRuntime from "../src/game/solver/solver-runtime";
import { createInitialGameState } from "../src/game/state";
import { GameScreen } from "../src/ui/game-screen";

vi.mock("../src/game/solver/solver-runtime.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/game/solver/solver-runtime")>(
    "../src/game/solver/solver-runtime.ts",
  );
  return {
    ...actual,
    solveBoardWithRuntime: vi.fn(),
  };
});

type LatencyBaseline = {
  sampleCount: number;
  baselineSolveTriggerCommitDurationMsP95: number;
  baselineSolveApplyCommitDurationMsP95: number;
  maxRegressionVsBaselineMs: number;
  maxSolveTriggerCommitDurationMsP95: number;
  maxSolveApplyCommitDurationMsP95: number;
};

type SolveResult = Awaited<ReturnType<typeof solverRuntime.solveBoardWithRuntime>>;
type DeferredSolve = {
  promise: Promise<SolveResult>;
  resolve: (value: SolveResult) => void;
};
type RenderSample = {
  actualDuration: number;
  phase: "mount" | "update";
  solveState: string;
};

const BASELINE = solveLatencyBaseline as LatencyBaseline;

function makeDeferredSolve(): DeferredSolve {
  let resolveRef: ((value: SolveResult) => void) | null = null;
  return {
    promise: new Promise((resolve) => {
      resolveRef = resolve;
    }),
    resolve(value) {
      resolveRef?.(value);
    },
  };
}

function buildApplyStressPlacements() {
  const state = createInitialGameState();
  const placements: SolveResult["placements"] = [];
  for (const [pieceIndex, piece] of state.pieceCatalog.entries()) {
    for (let copy = 0; copy < 5; copy += 1) {
      placements.push({
        pieceId: piece.pieceId,
        transform: {
          rotation: ((copy * 90) % 360) as 0 | 90 | 180 | 270,
          flipped: ((pieceIndex + copy) & 1) === 0,
        },
        position: {
          x: (pieceIndex * 3 + copy * 2) % state.board.size.columns,
          y: (pieceIndex * 2 + copy) % state.board.size.rows,
        },
      });
    }
  }
  return placements;
}

async function waitFor(assertion: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (assertion()) {
      return;
    }
    await flushUi();
  }
  throw new Error("timed out waiting for condition");
}

function solveStatus(container: HTMLDivElement): string {
  const status = container.querySelector('[data-testid="pleomino-solve-state"]');
  if (!(status instanceof HTMLElement)) {
    throw new Error("expected solve status element");
  }
  return (status.textContent ?? "").trim();
}

function createRenderSampleRecorder(
  container: HTMLDivElement,
  samples: RenderSample[],
): React.ProfilerOnRenderCallback {
  return (_id, phase, actualDuration) => {
    samples.push({
      actualDuration,
      phase,
      solveState: solveStatus(container),
    });
  };
}

function measurePhaseCommitDuration(
  samples: readonly RenderSample[],
  startIndex: number,
  targetSolveState: string,
): number {
  let totalDuration = 0;
  for (let index = startIndex; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample?.phase === "update") {
      totalDuration += sample.actualDuration;
    }
    if (sample?.solveState === targetSolveState) {
      return totalDuration;
    }
  }
  throw new Error(`missing profiler sample for solve state ${targetSolveState}`);
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

function guardedThreshold(baseline: number, budget: number, hardMax: number): number {
  return Math.min(hardMax, baseline + budget);
}

describe("game screen solve interaction latency guardrail", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    vi.clearAllMocks();
    if (root) {
      root.unmount();
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    await flushUi();
  });

  it("keeps solve trigger and apply-commit render cost within baseline budget", async () => {
    const placements = buildApplyStressPlacements();
    const solveBoardWithRuntime = vi.mocked(solverRuntime.solveBoardWithRuntime);
    const triggerSamples: number[] = [];
    const applySamples: number[] = [];

    for (let sample = 0; sample < BASELINE.sampleCount; sample += 1) {
      const deferred = makeDeferredSolve();
      const renderSamples: RenderSample[] = [];
      solveBoardWithRuntime.mockImplementationOnce(() => deferred.promise);
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      root.render(
        <React.Profiler
          id="pleomino-game-screen"
          onRender={createRenderSampleRecorder(container, renderSamples)}
        >
          <GameScreen url="/games/pleomino" />
        </React.Profiler>,
      );
      await flushUi();
      await waitFor(() => container !== null && solveStatus(container) === "idle");

      const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
      if (!(solveButton instanceof HTMLElement)) {
        throw new Error("expected solve button");
      }

      const triggerStartIndex = renderSamples.length;
      solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await waitFor(() => container !== null && solveStatus(container) === "solving");
      triggerSamples.push(measurePhaseCommitDuration(renderSamples, triggerStartIndex, "solving"));

      const applyStartIndex = renderSamples.length;
      deferred.resolve({
        status: "solved",
        placements,
        nodeExpansions: 250,
        elapsedMs: 4,
        interestingnessScore: 0.5,
        selectedSignature: "pr14-latency-baseline",
      });
      await waitFor(() => container !== null && solveStatus(container) === "solved-applied");
      applySamples.push(
        measurePhaseCommitDuration(renderSamples, applyStartIndex, "solved-applied"),
      );

      root.unmount();
      root = null;
      container.remove();
      container = null;
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
      await flushUi();
    }

    const triggerP95 = percentile95(triggerSamples);
    const applyP95 = percentile95(applySamples);
    const triggerThreshold = guardedThreshold(
      BASELINE.baselineSolveTriggerCommitDurationMsP95,
      BASELINE.maxRegressionVsBaselineMs,
      BASELINE.maxSolveTriggerCommitDurationMsP95,
    );
    const applyThreshold = guardedThreshold(
      BASELINE.baselineSolveApplyCommitDurationMsP95,
      BASELINE.maxRegressionVsBaselineMs,
      BASELINE.maxSolveApplyCommitDurationMsP95,
    );

    expect(triggerP95).toBeLessThanOrEqual(triggerThreshold);
    expect(applyP95).toBeLessThanOrEqual(applyThreshold);
  });
});
