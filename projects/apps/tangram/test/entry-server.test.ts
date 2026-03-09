import { describe, expect, it } from "vitest";
import { render, renderParts } from "../src/entry-server.ts";

describe("render", () => {
  it("renders tangram shell markup and emits RNW stylesheet separately", () => {
    const html = render("/games/tangram");
    const parts = renderParts("/games/tangram");

    expect(parts.styleHtml).toContain('id="react-native-stylesheet"');
    expect(html).toContain("Tangram Sandbox");
    expect(html).toContain("Piece Tray");
    expect(html).toMatch(/Board \((?:<!-- -->)?10(?:<!-- -->)?x(?:<!-- -->)?15(?:<!-- -->)?\)/);
    expect(html).toContain("/games/tangram");
    expect(html.match(/data-testid="tangram-board-row"/g)?.length ?? 0).toBe(15);
    expect(html.match(/data-testid="tangram-board-cell"/g)?.length ?? 0).toBe(150);
  });
});
