import path from "node:path";
import * as fsp from "node:fs/promises";
import { runNodeWithZx } from "../../lib/node-run";
import { buildToolPath, zxInitPath } from "../dev-build/paths";
import { sharedUnifiedStorePath } from "./importers";

export async function prewarmUnifiedPnpmStore(opts: {
  repoRoot: string;
  dryRun: boolean;
  verbose: boolean;
}) {
  if (opts.dryRun) {
    if (opts.verbose) console.log("[install-deps] skipping unified pnpm prewarm in --dry-run mode");
    return;
  }
  try {
    const liveRepoRoot = String(process.env.REPO_ROOT || "").trim();
    const preferShared = !!liveRepoRoot && path.resolve(liveRepoRoot) !== opts.repoRoot;
    const declaredShared = String(process.env.VBR_SHARED_UNIFIED_PNPM_STORE_PATH || "").trim();
    const sharedPath =
      declaredShared || (preferShared ? await sharedUnifiedStorePath(liveRepoRoot) : "");
    if (sharedPath) {
      await fsp.access(sharedPath);
      if (opts.verbose) {
        console.log(
          `[install-deps] skipping temp-workspace unified prewarm; using shared store ${sharedPath}`,
        );
      }
      return;
    }
    if (opts.verbose) console.log("[install-deps] prewarming unified pnpm store");
    await runNodeWithZx({
      cwd: opts.repoRoot,
      script: buildToolPath(opts.repoRoot, "tools/dev/require-unified-pnpm-store.ts"),
      args: [],
      zxInitPath: zxInitPath(opts.repoRoot),
      stdio: opts.verbose ? "inherit" : "pipe",
      timeoutMs:
        Number.parseInt(process.env.INSTALL_UNIFIED_PNPM_TIMEOUT_MS || "180000", 10) || 180000,
    });
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    const lockPath = path.join(
      opts.repoRoot,
      ".viberoots",
      "workspace",
      "buck",
      "unified-pnpm-store",
      "require.lock",
    );
    throw new Error(
      [
        `[install-deps] unified pnpm prewarm failed: ${msg}`,
        "[install-deps] To recover:",
        `  1) remove stale lock if present: rm -f "${lockPath}"`,
        "  2) rerun: i",
        "  3) retry verify/build command",
      ].join("\n"),
    );
  }
}
