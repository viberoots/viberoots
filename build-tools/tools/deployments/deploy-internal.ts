#!/usr/bin/env zx-wrapper
import { findRepoRoot } from "../lib/repo.ts";
import { runDeployCli } from "./deploy-cli.ts";

async function main() {
  await runDeployCli({
    workspaceRoot: await findRepoRoot(process.cwd()),
    publicFrontDoor: false,
    deploymentJsonErrorMessage:
      "internal deploy entrypoint requires --deployment <label>; --deployment-json is no longer accepted",
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
