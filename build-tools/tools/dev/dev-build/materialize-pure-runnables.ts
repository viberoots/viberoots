import * as fsp from "node:fs/promises";
import path from "node:path";
import { formatRunnableLine, parseRunnableManifest } from "../../lib/runnables";

function isLikelyBuckTarget(token: string): boolean {
  if (!token || token.includes("...")) return false;
  return token.startsWith("//") || token.includes(":");
}

export function extractSpecificTargets(tokens: string[]): string[] {
  const specific: string[] = [];
  let skipNext = false;
  for (const rawToken of tokens) {
    const token = rawToken || "";
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token === "--") break;
    if (token === "--target-platforms" || token === "--user-platform" || token.startsWith("-")) {
      if (token === "--target-platforms" || token === "--user-platform") skipNext = true;
      continue;
    }
    if (isLikelyBuckTarget(token)) specific.push(token);
  }
  return specific;
}

export async function listBinArtifacts(outPath: string): Promise<string[]> {
  const binDir = path.join(outPath, "bin");
  const files = await fsp.readdir(binDir).catch(() => [] as string[]);
  return files.map((file) => path.join(binDir, file));
}

export async function printManifestRunnables(linkName: string): Promise<void> {
  try {
    const manifestPath = path.resolve(linkName, "manifest.json");
    const text = await fsp.readFile(manifestPath, "utf8").catch(() => "");
    if (!text) return;
    const entries = parseRunnableManifest(text);
    const runnables = entries.filter((entry) => !!entry.runnable);
    if (runnables.length) {
      console.log("Runnable targets:");
      for (const entry of runnables) console.log(` - ${formatRunnableLine(entry)}`);
      return;
    }

    const labels = entries.map((entry) => String(entry?.label || "")).filter(Boolean);
    if (labels.length) {
      console.log("Materialized graph; no runnable targets in manifest. Available labels:");
      for (const label of labels) console.log(` - ${label}`);
      console.log("See", manifestPath);
      return;
    }
    console.log("Materialized graph; no runnable targets found in manifest. See", manifestPath);
  } catch {}
}
