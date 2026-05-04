#!/usr/bin/env zx-wrapper
import path from "node:path";
import { collectChangedPaths } from "../lib/build-system-test-scope";
import { getFlagBool, getFlagList, getFlagStr, hasFlag } from "../lib/cli";
import { runNormalDeployment, summarizeDeploymentResult } from "./deployment-execution";
import { runDeploymentBatchFromChanges } from "./deployment-from-changes-run";
import { resolveDeploymentsFromChanges } from "./deployment-from-changes-selection";
import { resolveAllDeployments } from "./deployment-query";

function optionalResolvedFlag(name: string): string | undefined {
  if (!hasFlag(name)) return undefined;
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} requires a non-empty value`);
  return path.resolve(value);
}

function assertFromChangesConflicts() {
  const conflicts = [
    "deployment",
    "deployment-json",
    "artifact-dir",
    "publish-only",
    "preview",
    "preview-cleanup",
    "remove",
    "rollback",
    "source-run-id",
    "profile",
    "profile-root",
    "plan",
    "dry-run",
    "destination",
    "remote-repo-path",
    "remote-state-path",
    "remote-runtime-root",
    "remote-records-root",
    "ssh-mode",
    "retain-remote-artifact",
    "apply-host",
    "apply-host-dry-run",
    "remote-config-root",
    "remote-managed-root",
  ]
    .filter((flag) => hasFlag(flag))
    .map((flag) => `--${flag}`);
  if (conflicts.length > 0) {
    throw new Error(`--from-changes cannot be combined with ${conflicts.join(", ")}`);
  }
}

function collectSmokeConnectOverride() {
  const smokeConnectHost = getFlagStr("smoke-connect-host", "").trim();
  const smokeConnectPort = Number(getFlagStr("smoke-connect-port", "").trim() || 0);
  const smokeConnectProtocol = getFlagStr("smoke-connect-protocol", "https:").trim();
  if (!smokeConnectHost || smokeConnectPort <= 0) return undefined;
  return {
    protocol: smokeConnectProtocol === "http:" ? ("http:" as const) : ("https:" as const),
    hostname: smokeConnectHost,
    port: smokeConnectPort,
    rejectUnauthorized: false,
  };
}

export async function runFromChangesCli(workspaceRoot: string) {
  assertFromChangesConflicts();
  const changedPaths = (() => {
    const provided = getFlagList("changed");
    return provided.length > 0 ? provided : undefined;
  })();
  const deployments = await resolveAllDeployments(workspaceRoot);
  const plan = await resolveDeploymentsFromChanges({
    workspaceRoot,
    changedPaths: changedPaths || (await collectChangedPaths(workspaceRoot)),
    deployments,
  });
  const smokeConnectOverride = collectSmokeConnectOverride();
  const groupId =
    getFlagStr("deploy-batch-id", "").trim() || getFlagStr("group-id", "").trim() || undefined;
  const result = await runDeploymentBatchFromChanges({
    plan,
    deployBatchId: groupId,
    group: getFlagBool("group") || !!groupId,
    runDeployment: async (deployment, extra) =>
      await runNormalDeployment({
        workspaceRoot,
        deployment,
        sharedRecordsRoot: optionalResolvedFlag("records-root"),
        hostRoot: optionalResolvedFlag("host-root"),
        statePath: optionalResolvedFlag("state"),
        hostConfigPath: optionalResolvedFlag("host-config-out"),
        ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
        ...(extra.deployBatchId ? { deployBatchId: extra.deployBatchId } : {}),
      }),
  });
  console.log(
    JSON.stringify(
      {
        ...result,
        results: result.results.map((entry) => ({
          deploymentId: entry.deploymentId,
          deploymentLabel: entry.deploymentLabel,
          status: entry.status,
          reasons: entry.reasons,
          ...(entry.blockedBy ? { blockedBy: entry.blockedBy } : {}),
          ...(entry.error ? { error: entry.error } : {}),
          ...(entry.result ? { result: summarizeDeploymentResult(entry.result) } : {}),
        })),
      },
      null,
      2,
    ),
  );
}
