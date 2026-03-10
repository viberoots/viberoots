import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisFile = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(thisFile), "..");

describe("pwa metadata", () => {
  it("includes install metadata in index html", () => {
    const html = readFileSync(path.join(appRoot, "index.html"), "utf8");
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="Tangram"');
    expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(html).toContain('name="theme-color" content="#0b1324"');
  });

  it("ships a manifest with expected install fields", () => {
    const raw = readFileSync(path.join(appRoot, "public/manifest.webmanifest"), "utf8");
    const manifest = JSON.parse(raw) as {
      name?: string;
      display?: string;
      orientation?: string;
      start_url?: string;
      icons?: Array<{ src?: string; sizes?: string }>;
    };
    expect(manifest.name).toBe("Tangram");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("portrait");
    expect(manifest.start_url).toBe("/games/tangram");
    expect(manifest.icons?.some((icon) => icon.src === "/icons/icon-192.png")).toBe(true);
    expect(manifest.icons?.some((icon) => icon.src === "/icons/icon-512.png")).toBe(true);
  });
});
