import { describe, expect, it } from "vitest";
import { computeResponsiveMetrics } from "../src/ui/game-screen-responsive.ts";

describe("game screen responsive sizing", () => {
  it("caps desktop cell size so board plus toolbar fit within viewport height", () => {
    const metrics = computeResponsiveMetrics(1280, 844);
    expect(metrics.isStacked).toBe(false);
    expect(metrics.cellSize).toBeLessThanOrEqual(51);
  });

  it("keeps stacked mode sizing within configured limits", () => {
    const metrics = computeResponsiveMetrics(390, 844);
    expect(metrics.isStacked).toBe(true);
    expect(metrics.cellSize).toBeGreaterThanOrEqual(24);
    expect(metrics.cellSize).toBeLessThanOrEqual(56);
  });
});
