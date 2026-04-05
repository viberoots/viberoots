#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagStr, hasFlag } from "../lib/cli.ts";
import {
  deployRecordPathFor,
  readNixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

function resolveRecordPath(): string {
  if (hasFlag("record-path")) return path.resolve(requireFlag("record-path"));
  return deployRecordPathFor(
    path.resolve(requireFlag("records-root")),
    requireFlag("deploy-run-id"),
  );
}

async function main() {
  const recordPath = resolveRecordPath();
  const record = await readNixosSharedHostDeployRecord(recordPath);
  console.log(
    JSON.stringify(
      {
        deployRunId: record.deployRunId,
        recordPath,
        operationKind: record.operationKind,
        deploymentLabel: record.deploymentLabel,
        providerTargetIdentity: record.providerTargetIdentity,
        controlPlaneExecutionSnapshotPath: record.controlPlane?.executionSnapshotPath,
        admittedContext: record.admittedContext,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
