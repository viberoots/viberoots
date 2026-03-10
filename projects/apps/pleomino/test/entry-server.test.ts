import { describe, expect, it } from "vitest";
import { render, renderParts } from "../src/entry-server.ts";

describe("render", () => {
  it("renders reducer-driven pleomino markup and emits RNW stylesheet separately", () => {
    const html = render("/games/pleomino");
    const parts = renderParts("/games/pleomino");

    expect(parts.styleHtml).toContain('id="react-native-stylesheet"');
    expect(parts.appHtml).toBe(html);
    expect(html).toContain('data-testid="pleomino-board-grid"');
    expect(html).toContain('data-testid="pleomino-piece-tray-grid"');
    expect(html).toContain('data-testid="pleomino-action-reset"');
    expect(html.match(/data-testid="pleomino-board-row"/g)?.length ?? 0).toBe(15);
    expect(html.match(/data-testid="pleomino-board-cell"/g)?.length ?? 0).toBe(150);
    expect(html.match(/data-testid="pleomino-piece-view"/g)?.length ?? 0).toBe(8);
  });

  it("produces deterministic SSR markup for hydration handshake", () => {
    const first = renderParts("/games/pleomino");
    const second = renderParts("/games/pleomino");

    expect(second.appHtml).toBe(first.appHtml);
    expect(second.styleHtml).toBe(first.styleHtml);
  });
});
