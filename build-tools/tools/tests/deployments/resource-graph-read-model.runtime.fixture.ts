#!/usr/bin/env zx-wrapper
import path from "node:path";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import {
  localHarnessControlPlaneDatabaseUrl,
  syncBackendResourceGraphIndex,
  writeBackendRunActionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { seedWorkerEvidenceRows } from "../resource-graph-worker.fixture";
import {
  POLICY_REFS,
  PROVISIONER_POLICY_REFS,
  RELEASE_POLICY_REFS,
  cloudflareRecord,
  cloudflareStageState,
  fixtureDocuments,
  provisionerRecord,
  provisionerStageState,
  releaseActionRecord,
  sourcePlans,
} from "./resource-graph-read-model.reconciliation-fixture";

export function backendFor(tmp: string) {
  const recordsRoot = path.join(tmp, "records");
  return { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
}

export async function seedResourceGraphIntent(backend: ReturnType<typeof backendFor>) {
  await syncBackendResourceGraphIndex(backend, {
    ...fixtureDocuments(),
    sourceRef: "workspace-resource-graph-export",
    sourcePlans: sourcePlans(),
  });
}

export async function seedRuntimeRows(backend: ReturnType<typeof backendFor>, tmp: string) {
  await seedSubmission(backend, tmp, "submission-1", "demo-web", "run-1", "deploy");
  await seedSnapshot(backend, tmp, "submission-1", "demo-web", POLICY_REFS);
  await seedRecord(backend, tmp, "submission-1", "run-1", cloudflareRecord());
  await seedStage(backend, "demo-web", "staging", "run-1", cloudflareStageState());
  await seedSubmission(backend, tmp, "submission-2", "demo-infra", "run-2", "provision");
  await seedSnapshot(backend, tmp, "submission-2", "demo-infra", PROVISIONER_POLICY_REFS);
  await seedRecord(backend, tmp, "submission-2", "run-2", provisionerRecord());
  await seedStage(backend, "demo-infra", "staging", "run-2", provisionerStageState());
  await seedSubmission(backend, tmp, "submission-3", "demo-release", "run-3", "rollback");
  await seedSnapshot(backend, tmp, "submission-3", "demo-release", RELEASE_POLICY_REFS);
  await seedRecord(backend, tmp, "submission-3", "run-3", releaseActionRecord());
  await seedWorkerEvidenceRows(backend);
  await writeBackendRunActionDoc(
    backend,
    runAction("action-a", "submission-1", "retry", "2026-07-05T12:01:00.000Z"),
  );
  await writeBackendRunActionDoc(
    backend,
    runAction("action-b", "submission-1", "rollback", "2026-07-05T12:02:00.000Z"),
  );
  await seedArtifactRows(backend);
}

async function seedSubmission(
  backend: any,
  tmp: string,
  id: string,
  deployment: string,
  run: string,
  op: string,
) {
  await queryBackend(
    backend,
    `INSERT INTO submissions VALUES ($1,$2,$3,$4,$5,$6,NULL,$7::jsonb,$8)`,
    [
      id,
      path.join(tmp, `${id}.json`),
      path.join(tmp, `${id}-snapshot.json`),
      deployment,
      "finished",
      run,
      JSON.stringify({
        submissionId: id,
        deploymentId: deployment,
        operationKind: op,
        deployRunId: run,
      }),
      "2026-07-05T12:00:00.000Z",
    ],
  );
}

async function seedSnapshot(
  backend: any,
  tmp: string,
  id: string,
  deployment: string,
  refs: any[],
) {
  await queryBackend(backend, `INSERT INTO snapshots VALUES ($1,$2,$3::jsonb,$4)`, [
    id,
    path.join(tmp, `${id}-snapshot.json`),
    JSON.stringify({ submissionId: id, deploymentId: deployment, policyResourceRefs: refs }),
    "2026-07-05T12:00:00.000Z",
  ]);
}

async function seedRecord(backend: any, tmp: string, submission: string, run: string, doc: any) {
  await queryBackend(backend, `INSERT INTO deploy_records VALUES ($1,$2,$3,$4::jsonb,$5)`, [
    run,
    submission,
    path.join(tmp, `${run}-record.json`),
    JSON.stringify(doc),
    "2026-07-05T12:01:00.000Z",
  ]);
}

async function seedStage(backend: any, deployment: string, stage: string, run: string, doc: any) {
  await queryBackend(backend, `INSERT INTO current_stage_state VALUES ($1,$2,$3,$4::jsonb,$5)`, [
    deployment,
    stage,
    run,
    JSON.stringify(doc),
    "2026-07-05T12:00:00.000Z",
  ]);
  await queryBackend(backend, `INSERT INTO stage_state_history VALUES ($1,$2,$3,$4::jsonb,$5)`, [
    deployment,
    stage,
    run,
    JSON.stringify(doc),
    "2026-07-05T12:00:00.000Z",
  ]);
}

async function seedArtifactRows(backend: any) {
  await queryBackend(
    backend,
    `INSERT INTO artifact_challenges VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      "challenge-1",
      "nonce",
      1783270000000,
      "2026-07-05T12:03:00.000Z",
      "operator",
      "key-1",
      JSON.stringify({
        finalizedStagedArtifactReference: "object://artifact-store/artifact-1",
        request: { deploymentId: "demo-web", proofKey: "proof-secret" },
      }),
    ],
  );
  await queryBackend(
    backend,
    `INSERT INTO static_webapp_upload_sessions VALUES ($1,$2,$3::jsonb,$4,$5)`,
    [
      "upload-1",
      "submission-1",
      JSON.stringify({
        archiveFormat: "tar.gz",
        archivePath: "uploads/demo.tgz",
        archiveObject: { key: "artifact-1" },
        digest: "sha256:abc",
        sizeBytes: 12,
        payload: "raw-secret",
      }),
      "2026-07-06T12:00:00.000Z",
      "2026-07-05T12:00:00.000Z",
    ],
  );
  await queryBackend(backend, `INSERT INTO artifact_objects VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [
    "artifact-1",
    "bucket",
    "sha256:def",
    12,
    "application/gzip",
    JSON.stringify({ sourcePlanRef: "source-plan:local-selected", token: "raw-secret" }),
    "2026-07-05T12:00:00.000Z",
  ]);
  await queryBackend(
    backend,
    `INSERT INTO artifact_cleanup_janitor_records VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      "cleanup-1",
      "submission-1",
      "demo-web",
      "rejected_staged_upload",
      JSON.stringify({ cleanupError: "cleanup failed (permission_denied)" }),
      "2026-07-05T12:04:00.000Z",
    ],
  );
}

function runAction(actionId: string, submissionId: string, action: string, submittedAt: string) {
  return { actionId, submissionId, action, submittedAt };
}
