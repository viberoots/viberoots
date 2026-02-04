import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runNodeWithZx } from "../../lib/node-run.ts";

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function prewarmVerifyOnce(root: string, zxInitPath: string): Promise<void> {
  const unifiedStamp = path.join(root, "buck-out", ".unified-pnpm-store", "path");
  if (!(await exists(unifiedStamp))) {
    await runNodeWithZx({
      cwd: root,
      script: path.join(root, "build-tools/tools/dev/require-unified-pnpm-store.ts"),
      args: [],
      zxInitPath,
      stdio: "pipe",
    }).catch(() => {});
  }

  if ((process.env.VERIFY_PREWARM || "0").trim() === "1") {
    await runNodeWithZx({
      cwd: root,
      script: path.join(root, "build-tools/tools/dev/prewarm-toolchains.ts"),
      args: [],
      zxInitPath,
      stdio: "pipe",
    }).catch(() => {});
  }
}
