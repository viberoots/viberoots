import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function chmodRecursive(root: string): Promise<void> {
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

export async function makeWorkspace(args: {
  lang: string;
  originPath: string;
  moduleKey: string;
}): Promise<string> {
  const { lang, originPath, moduleKey } = args;
  const base = path.join(os.tmpdir(), `bucknix-patch-${lang}`);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const pid = String(process.pid || 0);
  const rand = crypto.randomBytes(3).toString("hex");
  const safeKey = moduleKey.replace(/[^A-Za-z0-9._@-]+/g, "_");
  const dst = path.join(base, `${safeKey}-${stamp}-${pid}-${rand}`);
  await fsp.mkdir(base, { recursive: true });
  // macOS optimization: prefer APFS CoW clones when available; fall back to a normal copy.
  // Other platforms: regular copy.
  let copied = false;
  if (process.platform === "darwin") {
    try {
      // -c: clone, -R: recursive, -p: preserve mode/ownership/timestamps where possible
      const r1 = await $({ stdio: "pipe" })`cp -cRp ${originPath}/ ${dst}/`.nothrow();
      if (r1.exitCode === 0) {
        copied = true;
      } else {
        const r2 = await $({ stdio: "pipe" })`cp -a ${originPath}/ ${dst}/`.nothrow();
        if (r2.exitCode === 0) copied = true;
      }
    } catch {
      // fall through and use the generic fallback
    }
  }
  if (!copied) {
    // Node's recursive cp as a robust cross-platform fallback
    await fsp.cp(originPath, dst, { recursive: true, force: true });
  }
  // Ensure workspace is writable even if source tree had read-only bits
  await chmodRecursive(dst);
  return dst;
}
