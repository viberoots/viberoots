import React from "react";
import { savePersistedGameStateToHash } from "../game/persistence";
import type { GameState } from "../game/types";

const useClientLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

function appRootElement(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.getElementById("app");
}

function setAppRootReady(root: HTMLElement, ready: boolean): void {
  root.setAttribute("data-ui-ready", ready ? "true" : "false");
}

function scheduleAppRootReveal(root: HTMLElement, onReveal: () => void): () => void {
  let cancelled = false;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;

  const reveal = () => {
    if (cancelled) {
      return;
    }
    setAppRootReady(root, true);
    onReveal();
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
}

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
  const hasRevealedRef = React.useRef(false);

  useClientLayoutEffect(() => {
    const root = appRootElement();
    if (!root || hasRevealedRef.current) {
      return;
    }
    setAppRootReady(root, false);
    if (args.viewport.width <= 0 || args.viewport.height <= 0 || !args.persistenceReady) {
      return;
    }
    return scheduleAppRootReveal(root, () => {
      hasRevealedRef.current = true;
    });
  }, [args.persistenceReady, args.viewport.height, args.viewport.width]);
}
