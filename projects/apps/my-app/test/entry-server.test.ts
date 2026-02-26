import { describe, expect, it } from "vitest";
import { render } from "../src/entry-server.ts";

describe("render", () => {
  it("renders SSR markup and escapes quotes in URL", () => {
    const html = render('/hello/"vite"');
    expect(html).toContain('id="app"');
    expect(html).toContain('data-ssr-marker="vite"');
    expect(html).toContain("&quot;vite&quot;");
  });
});
