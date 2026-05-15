#!/usr/bin/env zx-wrapper
import path from "node:path";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import {
  localHarnessControlPlaneDatabaseUrl,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";

export const MCP_TEST_TOKEN = "control-plane-mcp-token";

export function mcpBackendFor(tmp: string) {
  const recordsRoot = path.join(tmp, "records");
  return { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
}

export async function mcpServiceFor(
  tmp: string,
  backend: { recordsRoot: string; databaseUrl: string },
  opts: {
    mcp?: { enabled: boolean; basePath: string };
    localFixture?: boolean;
    token?: string;
  } = {},
) {
  return await startNixosSharedHostControlPlaneServer({
    workspaceRoot: tmp,
    paths: {
      statePath: path.join(tmp, "state.json"),
      hostRoot: tmp,
      recordsRoot: backend.recordsRoot,
    },
    backendDatabaseUrl: backend.databaseUrl,
    ...(opts.token !== undefined
      ? { token: opts.token }
      : opts.localFixture
        ? {}
        : { token: MCP_TEST_TOKEN }),
    objectStore: memoryControlPlaneArtifactStore(),
    webUi: { enabled: true, basePath: "/" },
    mcp: opts.mcp || { enabled: true, basePath: "/mcp" },
    localFixture: opts.localFixture,
  });
}

export async function seedMcpSecretBearingState(
  backend: { recordsRoot: string; databaseUrl: string },
  tmp: string,
) {
  await writeBackendSubmissionDoc(
    backend,
    {
      submissionId: "submit-mcp",
      submittedAt: "2026-05-15T12:00:00.000Z",
      deploymentId: "demo-mcp",
      deploymentLabel: "//demo:mcp",
      operationKind: "deploy",
      lockScope: "demo-mcp",
      executionSnapshotPath: path.join(tmp, "snapshot.json"),
      lifecycleState: "finished",
      providerError: "Authorization: Bearer leaked",
    } as any,
    {
      submissionPath: path.join(tmp, "submission.json"),
      executionSnapshotPath: path.join(tmp, "snapshot.json"),
    },
  );
  await queryBackend(
    backend,
    `INSERT INTO deploy_records(deploy_run_id, submission_id, record_path, document_json, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      "run-mcp",
      "submit-mcp",
      path.join(tmp, "record.json"),
      JSON.stringify({
        deployRunId: "run-mcp",
        deploymentId: "demo-mcp",
        error: "token=super-secret",
        rawEnv: { VBR_TOKEN: "env-dump-secret" },
        artifact: { identity: "static-webapp:mcp", contents: "artifact-secret" },
      }),
      "2026-05-15T12:01:00.000Z",
    ],
  );
}
