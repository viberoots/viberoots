import fs from "fs-extra";
import os from "node:os";
import path from "node:path";

export async function makeWorkspace(originPath: string, moduleKey: string): Promise<string> {
  const base = path.join(os.tmpdir(), "bucknix-patch-go");
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const safeKey = moduleKey.replace(/[^A-Za-z0-9._@-]+/g, "_");
  const dst = path.join(base, `${safeKey}-${stamp}`);
  await fs.mkdirp(base);

  // On macOS, some environments may lack `cp -c` support; fall back immediately to cp -a.
  // On Linux, we intentionally skip overlay mounts in automated tests to avoid permissions prompts.
  // Fallback: plain recursive copy
  await $`cp -a ${originPath}/. ${dst}/`;
  return dst;
}
