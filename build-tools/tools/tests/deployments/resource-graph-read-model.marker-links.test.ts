#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { readBackendResourceGraphIndex } from "../../deployments/nixos-shared-host-control-plane-backend";
import { runInTemp } from "../lib/test-helpers";
import { backendFor, seedResourceGraphIntent } from "./resource-graph-read-model.runtime.fixture";

test("runtime evidence refs and worker claims participate in unlinked markers", async () => {
  await runInTemp("resource-graph-status-marker-ref-linked", async (tmp) => {
    const evidenceBackend = backendFor(`${tmp}/evidence`);
    await seedResourceGraphIntent(evidenceBackend);
    await seedRuntimeEvidence(evidenceBackend, "runtime-input", ["missing-deployment"]);
    const evidenceModel = await readBackendResourceGraphIndex(evidenceBackend);
    assert.equal(evidenceModel.runtime.status, "runtime-unlinked");
    assert.ok(
      evidenceModel.runtime.markers.examples.some(
        (example: any) => example.kind === "RuntimeInput",
      ),
    );

    const workerBackend = backendFor(`${tmp}/worker`);
    await seedResourceGraphIntent(workerBackend);
    await seedWorkerOnlyRuntimeRows(workerBackend, tmp);
    const workerModel = await readBackendResourceGraphIndex(workerBackend);
    assert.equal(workerModel.runtime.status, "runtime-unlinked");
    assert.equal(workerModel.runtime.markers.unlinkedRuntimeRows, 1);
    assert.deepEqual(workerModel.runtime.markers.examples[0], {
      kind: "WorkerEvidence",
      name: "worker-unlinked",
      status: "runtime-unlinked",
      reason: "runtime row has no matching imported Deployment intent node",
    });
    assert.doesNotMatch(JSON.stringify(workerModel), /raw-secret|Bearer|token=/);
  });
});

async function seedRuntimeEvidence(
  backend: ReturnType<typeof backendFor>,
  name: string,
  refs: string[],
) {
  await queryBackend(
    backend,
    `INSERT INTO resource_graph_runtime_evidence(
       kind, name, source_class, source_label, document_json, imported_at
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      "RuntimeInput",
      name,
      "runtime",
      "admitted-control-plane-runtime",
      JSON.stringify({ kind: "RuntimeInput", id: name, refs, facts: { mode: "test" } }),
      "2026-07-05T12:00:00.000Z",
    ],
  );
}

async function seedWorkerOnlyRuntimeRows(backend: ReturnType<typeof backendFor>, tmp: string) {
  await queryBackend(
    backend,
    `INSERT INTO submissions VALUES ($1,$2,$3,$4,$5,$6,NULL,$7::jsonb,$8)`,
    [
      "worker-submission",
      `${tmp}/worker-submission.json`,
      `${tmp}/worker-submission-snapshot.json`,
      "missing-deployment",
      "running",
      "worker-run",
      JSON.stringify({
        submissionId: "worker-submission",
        deploymentId: "missing-deployment",
        deployRunId: "worker-run",
      }),
      "2026-07-05T12:00:00.000Z",
    ],
  );
  await queryBackend(backend, `INSERT INTO queue VALUES ($1,$2,$3,$4,$5,NULL)`, [
    "worker-submission",
    "2026-07-05T12:00:00.000Z",
    "worker-unlinked",
    "claim-token",
    Date.parse("2026-07-05T12:10:00.000Z"),
  ]);
  await queryBackend(backend, `INSERT INTO worker_heartbeats VALUES ($1,$2,$3,$4,$5::jsonb)`, [
    "worker-unlinked",
    "instance-1",
    "running",
    "2026-07-05T12:00:00.000Z",
    JSON.stringify({ supportedExecutionModes: ["deployment-control-plane"], token: "raw-secret" }),
  ]);
}
