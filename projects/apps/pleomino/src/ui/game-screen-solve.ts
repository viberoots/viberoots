import React from "react";
import type { GameAction } from "../game/reducer";
import { solveBoardWithRuntime } from "../game/solver/solver-runtime";
import { createSolverRequestFromGameState } from "../game/solver/solver";
import type { GameHistoryState, GameState } from "../game/types";

const SOLVER_MAX_NODE_EXPANSIONS = 150_000;
const SOLVER_MAX_WALL_CLOCK_MS = 1_200;

export type SolveUiState = "idle" | "solving" | "solved-applied" | "unsolved";

function deferSolveStart(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function useGameScreenSolve(args: {
  state: GameHistoryState;
  dispatch: React.Dispatch<GameAction>;
}) {
  const stateRef = React.useRef<GameState>(args.state.present);
  const requestTokenRef = React.useRef(0);
  const [solveState, setSolveState] = React.useState<SolveUiState>("idle");
  const [isApplyingSolve, setIsApplyingSolve] = React.useState(false);

  React.useEffect(() => {
    stateRef.current = args.state.present;
  }, [args.state.present]);

  const handleSolve = React.useCallback(async () => {
    if (solveState === "solving") {
      return;
    }
    const startState = stateRef.current;
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    args.dispatch({ type: "solve/request" });
    setSolveState("solving");
    await deferSolveStart();
    let result: Awaited<ReturnType<typeof solveBoardWithRuntime>>;
    try {
      result = await solveBoardWithRuntime(
        createSolverRequestFromGameState(
          startState,
          SOLVER_MAX_NODE_EXPANSIONS,
          SOLVER_MAX_WALL_CLOCK_MS,
        ),
      );
    } catch {
      if (requestToken === requestTokenRef.current) {
        setSolveState("unsolved");
      }
      return;
    }
    if (requestToken !== requestTokenRef.current) {
      return;
    }
    if (stateRef.current !== startState) {
      setSolveState("idle");
      return;
    }
    if (result.status !== "solved") {
      setSolveState("unsolved");
      return;
    }
    setIsApplyingSolve(true);
    args.dispatch({ type: "solve/apply", placements: result.placements });
    setIsApplyingSolve(false);
    setSolveState("solved-applied");
  }, [args.dispatch, solveState]);

  React.useEffect(() => {
    return () => {
      requestTokenRef.current += 1;
    };
  }, []);

  return {
    handleSolve,
    solveState,
    isApplyingSolve,
  };
}
