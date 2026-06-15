import path from "node:path";
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
    if (preferShared && (await sharedUnifiedStorePath(liveRepoRoot))) {
      if (opts.verbose) {
        console.log(
          `[install-deps] skipping temp-workspace unified prewarm; using shared store marker from ${liveRepoRoot}`,
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
    const lockPath = path.join(opts.repoRoot, "buck-out", ".unified-pnpm-store", "require.lock");
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
