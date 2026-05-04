#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { getFlagStr } from "../lib/cli";
import { resolveDeploymentForCli } from "./deployment-cli-resolve";
import {
  normalizeLaneGovernanceSnapshot,
  verifyLaneGovernanceSnapshot,
} from "./deployment-admission-governance";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

async function main() {
  const workspaceRoot = process.cwd();
  const deployment = await resolveDeploymentForCli(workspaceRoot, requireFlag, {
    deploymentJsonErrorMessage:
      "lane governance verification requires --deployment <label>; --deployment-json is not accepted",
  });
  if (deployment.protectionClass === "local_only") {
    throw new Error("lane governance verification only applies to protected/shared deployments");
  }
  const snapshotPath = requireFlag("scm-policy-json");
  const snapshot = normalizeLaneGovernanceSnapshot(
    JSON.parse(await fsp.readFile(snapshotPath, "utf8")),
  );
  if (!snapshot) {
    throw new Error(`invalid --scm-policy-json payload: ${snapshotPath}`);
  }
  console.log(
    JSON.stringify(
      verifyLaneGovernanceSnapshot({
        lanePolicy: deployment.lanePolicy,
        snapshot,
      }),
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
