import path from "node:path";
import { runNodeWithZx } from "../../lib/node-run";
import { resolveWorkspaceRootsSync } from "../../lib/repo";
import { findGoImporterMissingSum } from "./presence";

type Mode = "ci" | "local";

export async function handleGoMissingSum(mode: Mode): Promise<void> {
  let goMissingSum = findGoImporterMissingSum();
  if (!goMissingSum.length) return;

  if (mode === "local") {
    try {
      const roots = resolveWorkspaceRootsSync();
      await runNodeWithZx({
        zxInitPath: path.join(roots.viberootsRoot, "build-tools/tools/dev/zx-init.mjs"),
        script: path.join(roots.viberootsRoot, "build-tools/tools/dev/install-deps.ts"),
        args: ["--glue-only"],
      });
    } catch {}
    // Re-check after best-effort local tidy
    goMissingSum = findGoImporterMissingSum();
  }

  if (!goMissingSum.length) return;
  if (mode === "ci") {
    for (const imp of goMissingSum) {
      console.error(
        `ERROR: ${imp} has go.mod but no go.sum. Run 'u' to reconcile tracked Go metadata`,
      );
    }
    process.exit(1);
  }

  for (const imp of goMissingSum) {
    console.warn(
      `WARN: ${imp} has go.mod but no go.sum (local only). Run 'u' to reconcile tracked Go metadata.`,
    );
  }
}
