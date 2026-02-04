import path from "node:path";
import { runNodeWithZx } from "../../lib/node-run.ts";
import { findGoImporterMissingSum } from "./presence.ts";

type Mode = "ci" | "local";

export async function handleGoMissingSum(mode: Mode): Promise<void> {
  let goMissingSum = findGoImporterMissingSum();
  if (!goMissingSum.length) return;

  if (mode === "local") {
    try {
      await runNodeWithZx({
        zxInitPath: path.resolve("build-tools/tools/dev/zx-init.mjs"),
        script: path.resolve("build-tools/tools/dev/install-deps.ts"),
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
        `ERROR: ${imp} has go.mod but no go.sum. Run 'build-tools/tools/dev/install-deps.ts' to auto-tidy or add --skip-go-tidy to bypass`,
      );
    }
    process.exit(1);
  }

  for (const imp of goMissingSum) {
    console.warn(
      `WARN: ${imp} has go.mod but no go.sum (local only). You can run 'build-tools/tools/dev/install-deps.ts' to tidy when online.`,
    );
  }
}
