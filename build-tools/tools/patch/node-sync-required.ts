#!/usr/bin/env zx-wrapper
import path from "node:path";
import { readImporterArg } from "../lib/cli";
import { resolveImporterDir } from "../lib/lockfiles";
import { runNodeWithZx } from "../lib/node-run";
import { repoRoot } from "./lib/apply";

export async function runNodeSyncRequired(args: string[]): Promise<void> {
  const importerRel = await resolveImporterDir(process.cwd(), readImporterArg("") || undefined);
  const root = repoRoot();
  const zxInitPath = path.join(root, "build-tools", "tools", "dev", "zx-init.mjs");
  const script = path.join(
    root,
    "build-tools",
    "tools",
    "buck",
    "enforce-node-patch-requirements.ts",
  );
  const scriptArgs = ["--check", "--importer", importerRel];
  if (args.includes("--write-placeholders")) {
    scriptArgs.push("--write-placeholders");
  }
  await runNodeWithZx({
    zxInitPath,
    script,
    args: scriptArgs,
    stdio: "inherit",
  });
}
