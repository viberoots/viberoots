import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildToolPath } from "../dev-build/paths";
import { runNodeWithZx } from "../../lib/node-run";

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function prewarmRecoveryHint(root: string): string {
  const lockPath = path.join(
    root,
    ".viberoots",
    "workspace",
    "buck",
    "unified-pnpm-store",
    "require.lock",
  );
  return [
    "[verify] unified prewarm skipped (non-fatal).",
    `  - If verify appears blocked by lock contention, run: rm -f "${lockPath}"`,
    "  - Then run: i",
    "  - Retry verify.",
  ].join("\n");
}

export async function prewarmVerifyOnce(root: string, zxInitPath: string): Promise<void> {
  const unifiedStamp = path.join(
    root,
    ".viberoots",
    "workspace",
    "buck",
    "unified-pnpm-store",
    "path",
  );
  const shouldPrewarmUnifiedInVerify = (process.env.VERIFY_PREWARM_UNIFIED || "0").trim() === "1";
  if (shouldPrewarmUnifiedInVerify && !(await exists(unifiedStamp))) {
    await runNodeWithZx({
      cwd: root,
      script: buildToolPath(root, "tools/dev/require-unified-pnpm-store.ts"),
      args: [],
      zxInitPath,
      stdio: "pipe",
      timeoutMs:
        Number.parseInt(process.env.VERIFY_PREWARM_UNIFIED_TIMEOUT_MS || "20000", 10) || 20000,
    }).catch((e: any) => {
      const msg = e?.message ? String(e.message) : String(e);
      process.stderr.write(
        `[verify] unified prewarm failed: ${msg}\n${prewarmRecoveryHint(root)}\n`,
      );
    });
  }

  if ((process.env.VERIFY_PREWARM || "0").trim() === "1") {
    await runNodeWithZx({
      cwd: root,
      script: buildToolPath(root, "tools/dev/prewarm-toolchains.ts"),
      args: [],
      zxInitPath,
      stdio: "pipe",
      timeoutMs: Number.parseInt(process.env.VERIFY_PREWARM_TIMEOUT_MS || "30000", 10) || 30000,
    }).catch((e: any) => {
      const msg = e?.message ? String(e.message) : String(e);
      process.stderr.write(
        `[verify] toolchain prewarm failed (non-fatal): ${msg}\n` +
          "  - Retry with VERIFY_PREWARM=1 once dependencies are healthy\n",
      );
    });
  }
}
