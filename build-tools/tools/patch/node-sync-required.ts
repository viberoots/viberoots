#!/usr/bin/env zx-wrapper
import { readImporterArg } from "../lib/cli";
import { resolveImporterDir } from "../lib/lockfiles";
import { runNodeWithZx } from "../lib/node-run";
import { buildToolPath, zxInitPath } from "../dev/dev-build/paths";
import { repoRoot } from "./lib/apply";

export async function runNodeSyncRequired(args: string[]): Promise<void> {
  const importerRel = await resolveImporterDir(process.cwd(), readImporterArg("") || undefined);
  const root = repoRoot();
  const script = buildToolPath(root, "tools/buck/enforce-node-patch-requirements.ts");
  const scriptArgs = ["--check", "--importer", importerRel];
  if (args.includes("--write-placeholders")) {
    scriptArgs.push("--write-placeholders");
  }
  await runNodeWithZx({
    zxInitPath: zxInitPath(root),
    script,
    args: scriptArgs,
    stdio: "inherit",
  });
}
