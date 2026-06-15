import process from "node:process";
import { runNodeWithZx } from "../../lib/node-run";
import { buildToolPath } from "../dev-build/paths";

export async function runTemplateManifestCheck(opts: {
  root: string;
  zxInitPath: string;
  nonBuildSystemOnlyScope: boolean;
}): Promise<void> {
  if (opts.nonBuildSystemOnlyScope) {
    process.stderr.write(
      "[verify] template-manifest check: skipped for non-build-system verify scope\n",
    );
    return;
  }
  await runNodeWithZx({
    cwd: opts.root,
    script: buildToolPath(opts.root, "tools/scaffolding/gen-template-manifest-artifacts.ts"),
    args: ["--check"],
    zxInitPath: opts.zxInitPath,
  });
}

export async function maybeWriteVerifyTimingSummary(opts: {
  root: string;
  logFile: string | null;
  zxInitPath: string;
}): Promise<void> {
  if (process.env.TEST_TIMING !== "summary" || !opts.logFile) return;
  await runNodeWithZx({
    cwd: opts.root,
    script: buildToolPath(opts.root, "tools/dev/analyze-verify-timing.ts"),
    args: ["--log", opts.logFile, "--comment"],
    zxInitPath: opts.zxInitPath,
    stdio: "pipe",
  }).catch(() => {});
}
