#!/usr/bin/env zx-wrapper
import process from "node:process";
import { collectChangedPaths } from "../lib/build-system-test-scope";
import { getFlagList, getFlagStr } from "../lib/cli";
import { resolveDeploymentImpactSelection } from "../lib/deployment-impact-selector";

async function main() {
  const root = getFlagStr("root", process.cwd());
  const changedPaths = getFlagList("changed").map((relPath) => String(relPath).trim());
  const result = resolveDeploymentImpactSelection(
    changedPaths.length > 0 ? changedPaths : await collectChangedPaths(root),
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(String((error as Error)?.stack || error));
  process.exit(1);
});
