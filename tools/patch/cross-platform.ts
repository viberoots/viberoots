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

  // macOS: prefer APFS CoW clone (cp -cR) when available; otherwise fall back to cp -a.
  if (process.platform === "darwin") {
    try {
      await $`cp -cR ${originPath}/. ${dst}/`;
      return dst;
    } catch {
      // fall through to cp -a
    }
  }
  await $`cp -a ${originPath}/. ${dst}/`;
  return dst;
}
