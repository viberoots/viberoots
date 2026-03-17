import { describe, expect, it } from "vitest";
import { computeResponsiveMetrics } from "../src/ui/game-screen-responsive.ts";

describe("game screen responsive sizing", () => {
  it("caps desktop cell size so board plus toolbar fit within viewport height", () => {
    const metrics = computeResponsiveMetrics(1280, 844);
    expect(metrics.isStacked).toBe(false);
    expect(metrics.cellSize).toBeLessThanOrEqual(50);
  });

  it("keeps stacked mode sizing within configured limits", () => {
    const metrics = computeResponsiveMetrics(390, 844);
    expect(metrics.isStacked).toBe(true);
    expect(metrics.cellSize).toBeGreaterThanOrEqual(24);
    expect(metrics.cellSize).toBeLessThanOrEqual(56);
  });

  it("reserves at least a 5px desktop bottom gap in large mode", () => {
    const metrics = computeResponsiveMetrics(1280, 844);
    const boardHeight = metrics.cellSize * 15 + 6 * 2 + 1 * 2;
    const totalHeight = 5 * 2 + 4 + 62 + boardHeight + 5;
    expect(totalHeight).toBeLessThanOrEqual(844);
  });
});
