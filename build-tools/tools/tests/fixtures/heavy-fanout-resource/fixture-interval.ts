import * as fsp from "node:fs/promises";
import path from "node:path";

export async function recordFixtureInterval(
  name: string,
  delayMs: number,
  expectsPermit = false,
): Promise<void> {
  const markerDir = String(process.env.VBR_HEAVY_FANOUT_MARKER_DIR || "").trim();
  if (!markerDir) throw new Error("missing VBR_HEAVY_FANOUT_MARKER_DIR");
  const permit = String(process.env.VBR_HEAVY_FANOUT_PERMIT || "");
  if (expectsPermit && permit !== "viberoots-heavy-fanout") {
    throw new Error(`unexpected heavy-fanout permit: ${JSON.stringify(permit)}`);
  }
  if (!expectsPermit && permit) throw new Error("ordinary fixture received heavy-fanout permit");
  await fsp.mkdir(markerDir, { recursive: true });
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const end = Date.now();
  await fsp.writeFile(path.join(markerDir, `${name}.json`), JSON.stringify({ start, end }) + "\n");
}
