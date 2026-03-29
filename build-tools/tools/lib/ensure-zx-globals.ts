import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let bootstrapped = false;

async function importIfExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    await import(pathToFileURL(absPath).href);
    return true;
  } catch {
    return false;
  }
}

async function importFromWorkspaceCandidates(): Promise<boolean> {
  const here = fileURLToPath(import.meta.url);
  const envRoots = [
    process.env.WORKSPACE_ROOT || "",
    process.env.BUCK_TEST_SRC || "",
    process.cwd(),
    path.resolve(path.dirname(here), "..", "..", ".."),
  ].filter(Boolean);
  const seen = new Set<string>();
  for (const root of envRoots) {
    const normalized = path.resolve(root);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const zxGlobals = path.join(normalized, "node_modules", "zx", "build", "globals.cjs");
    if (await importIfExists(zxGlobals)) return true;
  }
  return false;
}

async function importFromZxWrapper(): Promise<boolean> {
  try {
    const pathSep = process.platform === "win32" ? ";" : ":";
    const entries = String(process.env.PATH || "")
      .split(pathSep)
      .filter(Boolean);
    for (const entry of entries) {
      const candidate = path.join(
        entry,
        process.platform === "win32" ? "zx-wrapper.cmd" : "zx-wrapper",
      );
      try {
        await fs.access(candidate);
      } catch {
        continue;
      }
      const content = await fs.readFile(candidate, "utf8");
      const match = content.match(
        /--import(?:=|\s+)(['"]?)([^'"\s]*\/node_modules\/zx\/build\/globals\.(?:cjs|js))\1/,
      );
      if (match?.[2] && (await importIfExists(match[2]))) return true;
    }
  } catch {}
  return false;
}

export async function ensureZxGlobals(): Promise<void> {
  if (bootstrapped) return;
  const resolvedUrl = process.env.ZX_GLOBALS_URL || "";
  if (resolvedUrl) {
    try {
      await import(resolvedUrl);
      bootstrapped = true;
      return;
    } catch {}
  }
  if (await importFromWorkspaceCandidates()) {
    bootstrapped = true;
    return;
  }
  if (await importFromZxWrapper()) {
    bootstrapped = true;
    return;
  }
  try {
    await import("zx/globals");
  } catch {}
  bootstrapped = true;
}

await ensureZxGlobals();
