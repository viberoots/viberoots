import React from "react";
import { savePersistedGameStateToHash } from "../game/persistence";
import type { GameState } from "../game/types";

const useClientLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export function useGameScreenViewport(): { width: number; height: number } {
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });

  useClientLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const applyViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    applyViewport();
    window.addEventListener("resize", applyViewport);
    return () => window.removeEventListener("resize", applyViewport);
  }, []);

  return viewport;
}

export function useGameScreenPersistence(presentState: GameState): boolean {
  const [persistenceReady, setPersistenceReady] = React.useState(false);

  React.useEffect(() => {
    setPersistenceReady(true);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined" || !persistenceReady) {
      return;
    }
    try {
      savePersistedGameStateToHash(window.history, window.location, presentState);
    } catch {}
  }, [persistenceReady, presentState]);

  return persistenceReady;
}

export function useGameScreenReveal(args: {
  persistenceReady: boolean;
  viewport: { width: number; height: number };
}): void {
  useClientLayoutEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (args.viewport.width <= 0 || args.viewport.height <= 0 || !args.persistenceReady) {
      return;
    }
    const root = document.getElementById("app");
    if (!root) {
      return;
    }
    let cancelled = false;
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;

    const reveal = () => {
      if (!cancelled) {
        root.setAttribute("data-ui-ready", "true");
      }
    };

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(reveal);
    });

    return () => {
      cancelled = true;
      if (firstFrame !== null) {
        window.cancelAnimationFrame(firstFrame);
      }
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [args.persistenceReady, args.viewport.height, args.viewport.width]);
}
