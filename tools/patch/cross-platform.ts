import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function chmodRecursive(root: string): Promise<void> {
  const stack: string[] = [root];
  while (stack.length) {
    const cur = stack.pop() as string;
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      const p = path.join(cur, name);
      try {
        const st = await fsp.stat(p);
        const mode = (st.mode | 0o200) & 0o7777; // ensure user-write bit
        await fsp.chmod(p, mode);
        if (st.isDirectory()) stack.push(p);
      } catch {}
    }
  }
  try {
    const st = await fsp.stat(root);
    await fsp.chmod(root, (st.mode | 0o200) & 0o7777);
  } catch {}
}

export async function makeWorkspace(originPath: string, moduleKey: string): Promise<string> {
  const base = path.join(os.tmpdir(), "bucknix-patch-go");
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const safeKey = moduleKey.replace(/[^A-Za-z0-9._@-]+/g, "_");
  const dst = path.join(base, `${safeKey}-${stamp}`);
  await fsp.mkdir(base, { recursive: true });
  // Copy source tree into workspace using Node's recursive cp
  await fsp.cp(originPath, dst, { recursive: true, force: true });
  // Ensure workspace is writable even if source tree had read-only bits
  await chmodRecursive(dst);
  return dst;
}
