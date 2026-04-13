#!/usr/bin/env zx-wrapper
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getFlagStr, hasFlag } from "../lib/cli.ts";
import { readBackendDeployRecordByDeployRunId } from "./nixos-shared-host-control-plane-backend.ts";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

function requireBackendDatabaseUrl(): string {
  const value =
    getFlagStr("control-plane-database-url", "").trim() ||
    String(process.env.BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
  if (!value) {
    throw new Error(
      "shared admission inspect requires --control-plane-database-url or BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL",
    );
  }
  return value;
}

export async function inspectNixosSharedHostAdmission(opts: {
  recordsRoot: string;
  backendDatabaseUrl: string;
  deployRunId: string;
}) {
  const record = await readBackendDeployRecordByDeployRunId(
    {
      recordsRoot: path.resolve(opts.recordsRoot),
      databaseUrl: opts.backendDatabaseUrl,
    },
    opts.deployRunId,
  );
  if (!record) {
    throw new Error(`shared admission inspect could not find deploy run: ${opts.deployRunId}`);
  }
  return {
    deployRunId: record.deployRunId,
    operationKind: record.operationKind,
    deploymentId: record.deploymentId,
    deploymentLabel: record.deploymentLabel,
    providerTargetIdentity: record.providerTargetIdentity,
    lifecycleState: record.lifecycleState,
    finalOutcome: record.finalOutcome,
    controlPlaneSubmissionId: record.controlPlane?.submissionId,
    admittedContext: record.admittedContext,
  };
}

async function main() {
  if (hasFlag("record-path")) {
    throw new Error("shared admission inspect no longer accepts --record-path");
  }
  console.log(
    JSON.stringify(
      await inspectNixosSharedHostAdmission({
        recordsRoot: requireFlag("records-root"),
        backendDatabaseUrl: requireBackendDatabaseUrl(),
        deployRunId: requireFlag("deploy-run-id"),
      }),
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
