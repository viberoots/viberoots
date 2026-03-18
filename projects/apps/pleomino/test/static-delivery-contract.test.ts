import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisFile = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(thisFile), "..");

describe("static delivery contract", () => {
  it("uses static pwa build labels instead of SSR labels", () => {
    const targets = readFileSync(path.join(appRoot, "TARGETS"), "utf8");

    expect(targets).toContain('"webapp:static"');
    expect(targets).toContain('"webapp:pwa"');
    expect(targets).not.toContain('"webapp:ssr"');
    expect(targets).not.toContain('"framework:vite"');
  });

  it("ships a static app shell without SSR placeholders", () => {
    const html = readFileSync(path.join(appRoot, "index.html"), "utf8");

    expect(html).toContain('<div id="app" data-ui-ready="false"></div>');
    expect(html).not.toContain("<!--app-html-->");
    expect(html).not.toContain("data-ssr-marker");
    expect(html).not.toContain("<!--app-head-->");
  });

  it("drops the app-local express runtime from package dependencies", () => {
    const pkg = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(pkg.dependencies?.express).toBeUndefined();
    expect(pkg.devDependencies?.["@types/express"]).toBeUndefined();
    expect(pkg.scripts?.build).toBe("vite build");
    expect(pkg.scripts?.preview).toBe("vite preview");
    expect(pkg.scripts?.["dev:vite"]).toBe("vite");
  });

  it("keeps dead server-era runtime artifacts out of the app tree", () => {
    expect(existsSync(path.join(appRoot, "server"))).toBe(false);
    expect(existsSync(path.join(appRoot, "src", "entry-server.ts"))).toBe(false);
  });
});
