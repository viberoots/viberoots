#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA } from "../../deployments/deployment-control-plane-contract.ts";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract.ts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server.ts";
import { createNixosSharedHostSubmissionId } from "../../deployments/nixos-shared-host-control-plane-snapshot.ts";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop.ts";

export async function writeDemoArtifact(root: string, body = "demoapp"): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${body}</html>\n`, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

export async function writeSsrArtifact(
  root: string,
  body = "<html>demoapp-ssr</html>\n",
): Promise<void> {
  await fsp.mkdir(path.join(root, "dist", "server"), { recursive: true });
  await fsp.mkdir(path.join(root, "dist", "client"), { recursive: true });
  await fsp.writeFile(
    path.join(root, "dist", "server", "index.js"),
    [
      "import http from 'node:http';",
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "import { fileURLToPath } from 'node:url';",
      "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
      "const port = Number(process.env.PORT || '3000');",
      "const clientRoot = path.join(__dirname, '..', 'client');",
      "const server = http.createServer((req, res) => {",
      "  if (req.url === '/healthz') { res.writeHead(200); res.end('ok\\n'); return; }",
      "  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });",
      "  res.end(fs.readFileSync(path.join(clientRoot, 'index.html'), 'utf8'));",
      "});",
      "server.listen(port, process.env.HOST || '127.0.0.1');",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(path.join(root, "dist", "client", "index.html"), body, "utf8");
}

export async function withEnvOverrides<T>(
  overrides: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor<T>(fn: () => Promise<T | null>, message: string): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(25);
  }
  throw new Error(message);
}

export async function expectPausedSubmission<T>(
  run: Promise<T>,
  validate?: (error: any) => void,
): Promise<any> {
  let paused: any;
  await assert.rejects(run, (error: any) => {
    paused = error;
    validate?.(error);
    return true;
  });
  return paused;
}

export function smokeConnectOverride(port: number) {
  return {
    protocol: "https:" as const,
    hostname: "127.0.0.1",
    port,
    rejectUnauthorized: false,
  };
}

export async function startControlPlaneHarness(opts: {
  workspaceRoot: string;
  hostRoot: string;
  statePath?: string;
  recordsRoot?: string;
  hostConfigPath?: string;
}) {
  const paths = {
    statePath: opts.statePath || path.join(opts.workspaceRoot, "platform-state.json"),
    hostRoot: opts.hostRoot,
    recordsRoot: opts.recordsRoot || path.join(opts.workspaceRoot, "records"),
    ...(opts.hostConfigPath ? { hostConfigPath: opts.hostConfigPath } : {}),
  };
  const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(paths.recordsRoot);
  const controlPlane = await startNixosSharedHostControlPlaneServer({
    workspaceRoot: opts.workspaceRoot,
    paths,
    backendDatabaseUrl,
  });
  const worker = startNixosSharedHostControlPlaneWorkerLoop({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: paths.recordsRoot,
    backendDatabaseUrl,
  });
  return {
    paths,
    backendDatabaseUrl,
    controlPlane,
    worker,
    close: async () => {
      await worker.close();
      await controlPlane.close();
    },
  };
}

export async function assertFrozenSnapshotExecution(result: any): Promise<void> {
  const snapshot = JSON.parse(await fsp.readFile(result.executionSnapshotPath, "utf8"));
  assert.equal(snapshot.deploymentId, "demoapp-dev");
  assert.equal(snapshot.deploymentLabel, "//projects/deployments/demoapp-dev:deploy");
  assert.equal(snapshot.providerTargetIdentity, "nixos-shared-host:default:demoapp");
  assert.equal(snapshot.action.publishInput.kind, "exact-artifact");
  assert.equal(snapshot.provisionerPlan?.mutationClass, "non_destructive");
  assert.ok(snapshot.provisionerPlan?.artifactPath);
  assert.equal(
    snapshot.admittedContext.policyEvaluation.binding.provisionerPlanFingerprint,
    snapshot.provisionerPlan?.fingerprint,
  );
  assert.equal(snapshot.admittedContext.source.sourceRef, "env/pleomino/dev");
  assert.equal(snapshot.admittedContext.targetEnvironment.targetRef, "env/pleomino/dev");
  assert.equal(snapshot.admittedContext.policyEvaluation.binding.targetIdentity, result.lockScope);
  assert.equal(snapshot.action.publishInput.artifact.identity, result.record.artifact?.identity);
  assert.equal(result.record.providerTargetIdentity, "nixos-shared-host:default:demoapp");
  assert.equal(result.record.admittedContext.source.mode, "stage_branch_head");
  assert.equal(result.record.provisionerPlan?.fingerprint, snapshot.provisionerPlan?.fingerprint);
  assert.equal(
    result.record.admittedContext.policyEvaluation.binding.targetIdentity,
    result.lockScope,
  );
  assert.ok(result.record.controlPlane);
  assert.equal(result.record.controlPlane.submissionId, result.submission.submissionId);
  assert.equal(result.record.controlPlane.executionSnapshotPath, result.executionSnapshotPath);
}

export async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  assert.equal(response.ok, true, body);
  return JSON.parse(body) as T;
}

export async function submitServiceRequest(opts: {
  url: string;
  deployment: any;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
}) {
  return await readJson<any>(
    await fetch(new URL("/api/v1/submissions", opts.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
        submissionId: createNixosSharedHostSubmissionId(),
        submittedAt: new Date().toISOString(),
        deployment: opts.deployment,
        operationKind: "deploy",
        ...(opts.artifactDir ? { artifactDir: opts.artifactDir } : {}),
        ...(opts.artifactDirsByComponentId
          ? { artifactDirsByComponentId: opts.artifactDirsByComponentId }
          : {}),
        ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
        ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      }),
    }),
  );
}

export async function postCancelRunAction(url: string, submissionId: string) {
  return await readJson<any>(
    await fetch(new URL("/api/v1/run-actions", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
        actionId: "cancel-queued-1",
        submittedAt: new Date().toISOString(),
        submissionId,
        action: "cancel",
        idempotencyKey: "cancel-queued-1",
      }),
    }),
  );
}

export async function readStatus(url: string, submissionId: string) {
  const requestUrl = new URL("/api/v1/status", url);
  requestUrl.searchParams.set("submissionId", submissionId);
  return await readJson<any>(await fetch(requestUrl));
}

export async function readRecord(url: string, deployRunId: string) {
  const requestUrl = new URL("/api/v1/records", url);
  requestUrl.searchParams.set("deployRunId", deployRunId);
  return await readJson<any>(await fetch(requestUrl));
}
