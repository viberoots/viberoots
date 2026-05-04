#!/usr/bin/env zx-wrapper
import { findRepoRoot } from "../lib/repo";
import { runDeployCli } from "./deploy-cli";

async function main() {
  await runDeployCli({
    workspaceRoot: await findRepoRoot(process.cwd()),
    publicFrontDoor: true,
    deploymentJsonErrorMessage:
      "public repo-level deploy requires --deployment <label>; --deployment-json is not an operator source of truth",
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
