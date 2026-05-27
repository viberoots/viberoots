#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  assertContainerUser,
  findContainerRuntime,
  freePort,
  loadImage,
  removeContainer,
  writeContainerSmokeRuntimeTree,
} from "./control-plane-container-smoke.helpers";
import { buildImageTarball } from "./control-plane-oci-image.helpers";
import {
  corruptFakeS3Objects,
  createNetwork,
  E2E_TOKEN,
  ensurePostgresImage,
  queryPostgresJson,
  removeNetwork,
  waitForServiceReady,
  writeWorkspace,
} from "./control-plane-container-e2e.helpers";
import {
  callMcp,
  callMcpRaw,
  readJson,
  renderUiRoute,
  startControlPlaneService,
  startControlPlaneWorkers,
  startFixtures,
  submit,
  waitForFinished,
  writeE2eConfig,
} from "./control-plane-container-e2e-flow.helpers";
import {
  containerE2eDeploymentFixture,
  E2E_DEPLOYMENT_ID,
} from "./control-plane-container-e2e-deployment.helpers";
import { assertContainerRejectsMissingSecret } from "./control-plane-container-e2e-runtime.helpers";
import {
  assertDuplicateWorkerClaimRejected,
  assertStaleWorkerLosesAuthority,
} from "./control-plane-container-e2e-worker.helpers";
import { runInTemp } from "../lib/test-helpers";

test("container E2E fixture metadata is independent of demo projects", () => {
  const deployment = containerE2eDeploymentFixture();
  assert.equal(deployment.deploymentId, E2E_DEPLOYMENT_ID);
  assert.doesNotMatch(JSON.stringify(deployment), /pleomino/i);
  assert.match(deployment.label, /cloud-control-fixture/);
});

test("container E2E fixture rejects duplicate workers and stale worker authority", async () => {
  await runInTemp("control-plane-container-worker-claims", async (tmp) => {
    await assertDuplicateWorkerClaimRejected(tmp);
    await assertStaleWorkerLosesAuthority(tmp);
  });
});

test("container runtime fails closed when a required secret file is missing", async (t) => {
  const runtime = await findContainerRuntime();
  if (!runtime) {
    t.skip("no usable local Podman or Docker daemon is available");
    return;
  }
  const image = await buildImageTarball();
  await runInTemp("control-plane-container-missing-secret", async (tmp) => {
    const port = await freePort();
    const mounts = await writeContainerSmokeRuntimeTree(tmp, port, E2E_TOKEN);
    await writeE2eConfig(mounts.configPath, port);
    await loadImage(runtime, image);
    await assertContainerRejectsMissingSecret({ runtime, image, mounts });
  });
});

test("containerized control plane processes one fixture deployment through service and two workers", async (t) => {
  const runtime = await findContainerRuntime();
  if (!runtime) {
    t.skip("no usable local Podman or Docker daemon is available");
    return;
  }
  const postgresSkip = await ensurePostgresImage(runtime);
  if (postgresSkip) {
    assert.fail(postgresSkip);
  }
  const image = await buildImageTarball();
  const token = `container-e2e-${process.pid}`;
  const network = `vbr-cp-e2e-${token}`;
  const names = {
    postgres: `vbr-cp-e2e-postgres-${token}`,
    s3: `vbr-cp-e2e-s3-${token}`,
    service: `vbr-cp-e2e-service-${token}`,
    workers: [`vbr-cp-e2e-worker-a-${token}`, `vbr-cp-e2e-worker-b-${token}`],
  };
  await runInTemp("control-plane-container-e2e", async (tmp) => {
    const port = await freePort();
    const mounts = await writeContainerSmokeRuntimeTree(tmp, port, E2E_TOKEN);
    const workspace = await writeWorkspace(tmp);
    await writeE2eConfig(mounts.configPath, port);
    await loadImage(runtime, image);
    await createNetwork(runtime, network);
    try {
      await startFixtures(runtime, network, names, image.repoTag, tmp);
      await startControlPlaneService(
        runtime,
        network,
        names,
        image,
        mounts,
        workspace.workspace,
        port,
      );
      await waitForServiceReady(port, E2E_TOKEN);
      await assertContainerUser(runtime, names.service);

      const corrupted = await submit(port, workspace.artifactDir, "container-e2e-corrupted");
      await corruptFakeS3Objects(runtime, names.s3);
      await startControlPlaneWorkers(runtime, network, names, image, mounts, workspace.workspace);
      const failed = await waitForFinished(port, corrupted.submissionId);
      assert.equal(failed.lifecycleState, "finished");
      assert.equal(failed.finalOutcome, "failed");
      assert.match(JSON.stringify(failed), /digest mismatch|metadata mismatch/i);

      const first = await submit(port, workspace.artifactDir, "container-e2e-submission");
      const duplicate = await submit(port, workspace.artifactDir, "container-e2e-submission");
      assert.equal(duplicate.submissionId, first.submissionId);
      assert.equal(duplicate.dedupe?.mode, "duplicate");
      const status = await waitForFinished(port, first.submissionId);
      assert.equal(status.lifecycleState, "finished");
      assert.equal(status.finalOutcome, "succeeded");
      assert.ok(["e2e-worker-0", "e2e-worker-1"].includes(status.workerId));
      const queue = await readJson(port, "/api/v1/read/queue");
      assert.ok(queue.submissions.some((entry: any) => entry.submissionId === first.submissionId));
      assert.ok(
        queue.submissions.some((entry: any) => entry.submissionId === corrupted.submissionId),
      );
      assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
      assert.equal((await fetch(`http://127.0.0.1:${port}/queue`)).status, 200);
      const renderedStatus = await renderUiRoute(port, "/", "container-e2e-ui-status");
      const renderedQueue = await renderUiRoute(port, "/queue", "container-e2e-ui-queue");
      const renderedDetail = await renderUiRoute(
        port,
        `/deployment?deploymentId=${E2E_DEPLOYMENT_ID}`,
        "container-e2e-ui-detail",
      );
      assert.match(renderedStatus, /Status/i);
      assert.match(renderedStatus, /workers|artifactStore|database/i);
      assert.match(renderedQueue, /container-e2e-submission/);
      assert.match(renderedQueue, new RegExp(E2E_DEPLOYMENT_ID));
      assert.match(renderedDetail, new RegExp(E2E_DEPLOYMENT_ID));
      assert.match(renderedDetail, /succeeded/);
      assert.doesNotMatch(
        `${renderedStatus}\n${renderedQueue}\n${renderedDetail}`,
        /secret|PRIVATE KEY|postgres|run-actions|api\/v1\/submissions|<form|<button/i,
      );
      const detail = await readJson(port, `/api/v1/read/deployments/${E2E_DEPLOYMENT_ID}`);
      assert.equal(detail.latestRun.finalOutcome, "succeeded");
      const tools = await callMcpRaw(port, "tools/list", {}, "container-e2e-mcp-list");
      const toolNames = tools.result.tools.map((tool: any) => tool.name);
      assert.deepEqual(toolNames, [
        "deployment_control_plane_status",
        "deployment_queue",
        "deployment_detail",
        "deployment_auth_context",
      ]);
      assert.doesNotMatch(JSON.stringify(tools), /submit|approve|run_action|mutation/i);
      const mcp = await callMcp(port, "deployment_detail", { deploymentId: E2E_DEPLOYMENT_ID });
      assert.equal(mcp.result.data.latestRun.finalOutcome, "succeeded");
      const audit = await queryPostgresJson(
        runtime,
        names.postgres,
        `SELECT json_agg(document_json ORDER BY occurred_at) FROM control_plane_audit_events WHERE deployment_id = '${E2E_DEPLOYMENT_ID}' OR request_id IN ('container-e2e-mcp', 'container-e2e-mcp-list', 'ui-container-e2e-ui-status', 'ui-container-e2e-ui-queue')`,
      );
      assert.ok(
        audit.some(
          (event: any) =>
            event.requestId === "container-e2e-corrupted" &&
            event.operation === "deploy" &&
            event.result === "failed",
        ),
      );
      assert.ok(
        audit.some(
          (event: any) =>
            event.requestId === "container-e2e-submission" &&
            event.operation === "deploy" &&
            event.result === "succeeded",
        ),
      );
      assert.match(
        JSON.stringify({ status, renderedStatus, renderedQueue, renderedDetail, audit }),
        new RegExp(`e2e-worker-[01]|container-e2e-submission|${E2E_DEPLOYMENT_ID}`),
      );
      assert.ok(
        audit.some(
          (event: any) =>
            event.requestId === "ui-container-e2e-ui-status" &&
            event.operation === "read.status" &&
            event.deploymentId === "control-plane",
        ),
      );
      assert.ok(
        audit.some(
          (event: any) =>
            event.requestId === "ui-container-e2e-ui-status" &&
            event.operation === "read.auth_context" &&
            event.deploymentId === "control-plane",
        ),
      );
      assert.ok(
        audit.some(
          (event: any) =>
            event.requestId === "ui-container-e2e-ui-queue" &&
            event.operation === "read.queue" &&
            event.deploymentId === "control-plane",
        ),
      );
      assert.ok(
        audit.some(
          (event: any) =>
            event.requestId === "ui-container-e2e-ui-detail" &&
            event.operation === "read.deployment_detail" &&
            event.deploymentId === E2E_DEPLOYMENT_ID,
        ),
      );
      assert.ok(audit.some((event: any) => event.requestId === "container-e2e-mcp"));
      assert.ok(audit.some((event: any) => event.operation === "mcp.deployment_detail"));
      assert.ok(audit.some((event: any) => event.requestId === "container-e2e-mcp-list"));
      assert.ok(audit.some((event: any) => event.operation === "mcp.tools/list"));
      assert.doesNotMatch(
        JSON.stringify({ queue, detail, mcp, tools }),
        /pleomino|secret|PRIVATE KEY|postgres/i,
      );
      const awsLog = await fsp.readFile(path.join(tmp, "runtime/aws.log"), "utf8");
      assert.equal(awsLog.trim().split(/\n+/).length, 1);
    } finally {
      for (const name of [names.service, ...names.workers, names.s3, names.postgres]) {
        await removeContainer(runtime, name);
      }
      await removeNetwork(runtime, network);
    }
  });
});
