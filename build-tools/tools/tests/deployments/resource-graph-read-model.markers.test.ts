#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import {
  readBackendResourceGraphIndex,
  syncBackendResourceGraphIndex,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { runInTemp } from "../lib/test-helpers";
import {
  backendFor,
  seedResourceGraphIntent,
  seedRuntimeRows,
} from "./resource-graph-read-model.runtime.fixture";
import { sourcePlans } from "./resource-graph-read-model.reconciliation-fixture";

const TOKEN = "resource-graph-marker-token";

test("runtime status markers classify linked pre-read-model and unlinked rows", async () => {
  await runInTemp("resource-graph-status-markers", async (tmp) => {
    const linkedBackend = backendFor(`${tmp}/linked`);
    await seedResourceGraphIntent(linkedBackend);
    await seedRuntimeRows(linkedBackend, tmp);
    const linked = await readBackendResourceGraphIndex(linkedBackend);
    assert.equal(linked.runtime.status, "runtime-linked");
    assert.equal(linked.runtime.indexed, true);
    assert.equal(linked.runtime.markers.importedIntentGraph.status, "indexed");
    assert.ok(linked.runtime.markers.linkedRuntimeRows > 0);
    assert.equal(linked.runtime.markers.preReadModelRuntimeRows, 0);
    assert.equal(linked.runtime.markers.unlinkedRuntimeRows, 0);

    const preReadBackend = backendFor(`${tmp}/pre-read`);
    await seedMinimalRuntimeRows(
      preReadBackend,
      tmp,
      "old-deployment",
      "old-submission",
      "old-run",
    );
    const before = await deployRecords(preReadBackend);
    const preRead = await readBackendResourceGraphIndex(preReadBackend);
    assert.equal(preRead.runtime.status, "pre-read-model");
    assert.equal(preRead.runtime.indexed, false);
    assert.equal(preRead.runtime.markers.importedIntentGraph.status, "missing");
    assert.ok(preRead.runtime.markers.preReadModelRuntimeRows > 0);
    assert.equal(preRead.runtime.markers.unlinkedRuntimeRows, 0);
    assert.deepEqual(await deployRecords(preReadBackend), before);

    const unlinkedBackend = backendFor(`${tmp}/unlinked`);
    await seedResourceGraphIntent(unlinkedBackend);
    await seedRuntimeRows(unlinkedBackend, tmp);
    await queryBackend(unlinkedBackend, "DELETE FROM resource_graph_nodes WHERE name = $1", [
      "demo-web",
    ]);
    const unlinked = await readBackendResourceGraphIndex(unlinkedBackend);
    assert.equal(unlinked.runtime.status, "runtime-unlinked");
    assert.equal(unlinked.runtime.indexed, false);
    assert.equal(unlinked.runtime.markers.importedIntentGraph.status, "indexed");
    assert.ok(unlinked.runtime.markers.linkedRuntimeRows > 0);
    assert.ok(unlinked.runtime.markers.unlinkedRuntimeRows > 0);
    assert.match(
      unlinked.runtime.markers.examples[0]?.reason || "",
      /no matching imported Deployment intent node/,
    );
  });
});

test("read surfaces expose pre-read-model runtime status markers", async () => {
  await runInTemp("resource-graph-status-marker-routes", async (tmp) => {
    const backend = backendFor(tmp);
    await seedMinimalRuntimeRows(backend, tmp, "old-deployment", "old-submission", "old-run");
    const service = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: { statePath: `${tmp}/state.json`, hostRoot: tmp, recordsRoot: backend.recordsRoot },
      backendDatabaseUrl: backend.databaseUrl,
      token: TOKEN,
      objectStore: memoryControlPlaneArtifactStore(),
      webUi: { enabled: true, basePath: "/ops" },
      mcp: { enabled: true, basePath: "/mcp" },
    });
    try {
      const headers = { authorization: `Bearer ${TOKEN}`, "x-request-id": "markers-api" };
      const api = await readJson<any>(
        await fetch(new URL("/ops/api/v1/read/resource-graph", service.url), { headers }),
      );
      assert.equal(api.runtime.status, "pre-read-model");
      assert.ok(api.runtime.markers.preReadModelRuntimeRows > 0);
      const mcp = await callMcp(service.url);
      assert.equal(mcp.result.data.runtime.status, "pre-read-model");
      assert.doesNotMatch(JSON.stringify(api), /raw-secret|proof-secret|Bearer/);
    } finally {
      await service.close();
    }
  });
});

test("empty imported intent graph is not treated as linked runtime status", async () => {
  await runInTemp("resource-graph-status-marker-empty-intent", async (tmp) => {
    const backend = backendFor(tmp);
    await syncBackendResourceGraphIndex(backend, {
      sourceRef: "workspace-resource-graph-export",
      nodes: { apiVersion: "resource-graph-nodes@1", nodes: [] } as any,
      edges: { apiVersion: "resource-graph-edges@1", edges: [] } as any,
      sourcePlans: sourcePlans(),
      requireRuntimeEvidence: false,
    });
    await seedMinimalRuntimeRows(backend, tmp, "missing-deployment", "submission-1", "run-1");
    const model = await readBackendResourceGraphIndex(backend);
    assert.equal(model.runtime.status, "runtime-unlinked");
    assert.equal(model.runtime.markers.importedIntentGraph.status, "indexed");
    assert.equal(model.runtime.markers.importedIntentGraph.nodeCount, 0);
    assert.ok(model.runtime.markers.unlinkedRuntimeRows > 0);
  });
});

async function seedMinimalRuntimeRows(
  backend: ReturnType<typeof backendFor>,
  tmp: string,
  deploymentId: string,
  submissionId: string,
  deployRunId: string,
) {
  await queryBackend(
    backend,
    `INSERT INTO submissions VALUES ($1,$2,$3,$4,$5,$6,NULL,$7::jsonb,$8)`,
    [
      submissionId,
      `${tmp}/${submissionId}.json`,
      `${tmp}/${submissionId}-snapshot.json`,
      deploymentId,
      "finished",
      deployRunId,
      JSON.stringify({ submissionId, deploymentId, deployRunId, operationKind: "deploy" }),
      "2026-07-05T12:00:00.000Z",
    ],
  );
  await queryBackend(backend, `INSERT INTO snapshots VALUES ($1,$2,$3::jsonb,$4)`, [
    submissionId,
    `${tmp}/${submissionId}-snapshot.json`,
    JSON.stringify({ submissionId, deploymentId }),
    "2026-07-05T12:00:00.000Z",
  ]);
  await queryBackend(backend, `INSERT INTO deploy_records VALUES ($1,$2,$3,$4::jsonb,$5)`, [
    deployRunId,
    submissionId,
    `${tmp}/${deployRunId}-record.json`,
    JSON.stringify({ deployRunId, deploymentId, finalOutcome: "succeeded" }),
    "2026-07-05T12:01:00.000Z",
  ]);
}

async function deployRecords(backend: ReturnType<typeof backendFor>) {
  return (
    await queryBackend<any>(
      backend,
      "SELECT deploy_run_id, document_json FROM deploy_records ORDER BY deploy_run_id",
    )
  ).rows;
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status !== 200) assert.fail(await response.text());
  return (await response.json()) as T;
}

async function callMcp(serviceUrl: string) {
  return await readJson<any>(
    await fetch(new URL("/mcp", serviceUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        "x-request-id": "markers-mcp",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "markers-mcp",
        method: "tools/call",
        params: { name: "deployment_resource_graph", arguments: {} },
      }),
    }),
  );
}
