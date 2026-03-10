import { describe, expect, it } from "vitest";
import { render, renderParts } from "../src/entry-server.ts";

describe("render", () => {
  it("renders reducer-driven tangram markup and emits RNW stylesheet separately", () => {
    const html = render("/games/tangram");
    const parts = renderParts("/games/tangram");

    expect(parts.styleHtml).toContain('id="react-native-stylesheet"');
    expect(parts.appHtml).toBe(html);
    expect(html).toContain("Tangram Sandbox");
    expect(html).toContain("Piece Tray");
    expect(html).toContain("Toolbar");
    expect(html).toContain("Catalog pieces:");
    expect(html).toContain("Selected piece:");
    expect(html).toMatch(/Board \((?:<!-- -->)?10(?:<!-- -->)?x(?:<!-- -->)?15(?:<!-- -->)?\)/);
    expect(html).toContain("/games/tangram");
    expect(html.match(/data-testid="tangram-board-row"/g)?.length ?? 0).toBe(15);
    expect(html.match(/data-testid="tangram-board-cell"/g)?.length ?? 0).toBe(150);
    expect(html.match(/data-testid="tangram-piece-view"/g)?.length ?? 0).toBe(8);
  });

  it("produces deterministic SSR markup for hydration handshake", () => {
    const first = renderParts("/games/tangram");
    const second = renderParts("/games/tangram");

    expect(second.appHtml).toBe(first.appHtml);
    expect(second.styleHtml).toBe(first.styleHtml);
  });
});
