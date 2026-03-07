import { describe, expect, it } from "vitest";
import { render, renderParts } from "../src/entry-server.ts";

describe("render", () => {
  it("renders SSR homepage markup and emits RNW stylesheet separately", () => {
    const html = render("/hello/vite");
    const parts = renderParts("/hello/vite");
    expect(parts.styleHtml).toContain('id="react-native-stylesheet"');
    expect(html).toContain("Vite SSR + React Native Web");
    expect(html).toContain("/hello/vite");
  });
});
