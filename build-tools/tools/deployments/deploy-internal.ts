#!/usr/bin/env zx-wrapper
import { findRepoRoot } from "../lib/repo.ts";
import { runDeployCli } from "./deploy-cli.ts";

async function main() {
  await runDeployCli({
    workspaceRoot: await findRepoRoot(process.cwd()),
    allowDeploymentJson: true,
    deploymentJsonErrorMessage:
      "internal deploy entrypoint accepts --deployment-json; use build-tools/tools/deployments/deploy.ts for Buck-authoritative public runs",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
