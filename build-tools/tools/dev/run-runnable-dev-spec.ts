import * as fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunnableExec } from "../lib/runnables";

export async function directImporterDevSpec(
  workspaceRoot: string,
  importer: string,
  mode: "static" | "ssr",
  framework: string,
): Promise<RunnableExec | null> {
  if (!importer || path.isAbsolute(importer) || importer.startsWith("../")) return null;
  const importerRoot = path.join(workspaceRoot, importer);
  const watchScript = path.join(importerRoot, "scripts", "dev-wasm-watch.mjs");
  try {
    const st = await fsp.stat(watchScript);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  const viberootsRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  const devTool = path.join(viberootsRoot, "build-tools", "tools", "dev", "dev-with-wasm-watch.ts");
  const viteCmd =
    mode === "ssr"
      ? framework === "next"
        ? "node_modules/.bin/next dev -H 127.0.0.1 -p ${PORT:-4173}"
        : "node server/dev.mjs"
      : "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${PORT:-5187} --strictPort --clearScreen false --logLevel info";
  return {
    argv: [
      "zx-wrapper",
      devTool,
      "--vite-cmd",
      viteCmd,
      "--watch-cmd",
      "node scripts/dev-wasm-watch.mjs",
    ],
    cwd: importerRoot,
  };
}

export async function directStaticWebappDevSpec(
  workspaceRoot: string,
  importer: string,
): Promise<RunnableExec | null> {
  if (!importer || path.isAbsolute(importer) || importer.startsWith("../")) return null;
  const importerRoot = path.join(workspaceRoot, importer);
  const devScript = path.join(importerRoot, "scripts", "dev.ts");
  try {
    const st = await fsp.stat(devScript);
    if (st.isFile()) return { argv: ["zx-wrapper", "scripts/dev.ts"], cwd: importerRoot };
  } catch {}
  return {
    argv: [
      "node",
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "${PORT:-5187}",
      "--strictPort",
      "--clearScreen",
      "false",
      "--logLevel",
      "info",
    ],
    cwd: importerRoot,
  };
}
