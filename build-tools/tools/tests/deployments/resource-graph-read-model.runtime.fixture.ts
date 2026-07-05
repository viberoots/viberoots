#!/usr/bin/env zx-wrapper
import path from "node:path";
import { createDeploymentResourceGraphDocuments } from "../../deployments/resource-graph-export";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import {
  localHarnessControlPlaneDatabaseUrl,
  syncBackendResourceGraphIndex,
  writeBackendRunActionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";

export function backendFor(tmp: string) {
  const recordsRoot = path.join(tmp, "records");
  return { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
}

export async function seedResourceGraphIntent(backend: ReturnType<typeof backendFor>) {
  await syncBackendResourceGraphIndex(backend, {
    ...fixtureDocuments(),
    sourceRef: "workspace-resource-graph-export",
  });
}

export async function seedRuntimeRows(backend: ReturnType<typeof backendFor>, tmp: string) {
  await queryBackend(
    backend,
    `INSERT INTO submissions VALUES ($1, $2, $3, $4, $5, $6, NULL, $7::jsonb, $8)`,
    [
      "submission-1",
      path.join(tmp, "submission.json"),
      path.join(tmp, "snapshot.json"),
      "demo-web",
      "finished",
      "run-1",
      JSON.stringify(submissionDoc()),
      "2026-07-05T12:00:00.000Z",
    ],
  );
  await queryBackend(backend, `INSERT INTO snapshots VALUES ($1, $2, $3::jsonb, $4)`, [
    "submission-1",
    path.join(tmp, "snapshot.json"),
    JSON.stringify({ submissionId: "submission-1", deploymentId: "demo-web" }),
    "2026-07-05T12:00:00.000Z",
  ]);
  await queryBackend(backend, `INSERT INTO deploy_records VALUES ($1, $2, $3, $4::jsonb, $5)`, [
    "run-1",
    "submission-1",
    path.join(tmp, "record.json"),
    JSON.stringify({ deployRunId: "run-1", deploymentId: "demo-web", token: "raw-secret" }),
    "2026-07-05T12:01:00.000Z",
  ]);
  await writeBackendRunActionDoc(backend, runAction("action-a", "2026-07-05T12:01:00.000Z"));
  await writeBackendRunActionDoc(backend, runAction("action-b", "2026-07-05T12:02:00.000Z"));
  await seedEvidenceRows(backend);
}

function fixtureDocuments() {
  return createDeploymentResourceGraphDocuments({
    apiVersion: "deployment-resource-envelope-list@1",
    inventory: {} as any,
    errors: [],
    envelopes: [
      {
        apiVersion: "deployment.resource.viberoots.dev/v1",
        kind: "Deployment",
        metadata: {
          name: "demo-web",
          uid: "uid:deployment",
          labels: { "viberoots.dev/authority": "reviewed_intent" },
          ownerReferences: [],
        },
        spec: {},
        statusRef: "status:deployment",
        policyRefs: [],
        source: { class: "buck", label: "//demo:deploy" },
      } as any,
    ],
  });
}

async function seedEvidenceRows(backend: ReturnType<typeof backendFor>) {
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
        request: { deployment: { deploymentId: "demo-web" }, proofKey: "proof-secret" },
      }),
    ],
  );
  await queryBackend(
    backend,
    `INSERT INTO static_webapp_upload_sessions VALUES ($1,$2,$3::jsonb,$4,$5)`,
    [
      "upload-1",
      "submission-1",
      JSON.stringify({ digest: "sha256:abc", payload: "raw-secret", sizeBytes: 12 }),
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
    JSON.stringify({ sourcePlanRef: "source-plan:demo", token: "raw-secret" }),
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
      JSON.stringify({
        schemaVersion: "nixos-shared-host-staged-artifact-janitor@1",
        reason: "rejected_staged_upload",
        stagedReference: "object://artifact-store/staged-1",
        cleanupError: "cleanup failed (permission_denied)",
      }),
      "2026-07-05T12:04:00.000Z",
    ],
  );
  await queryBackend(backend, `INSERT INTO current_stage_state VALUES ($1,$2,$3,$4::jsonb,$5)`, [
    "demo-web",
    "staging",
    "run-1",
    JSON.stringify(stageState()),
    "2026-07-05T12:00:00.000Z",
  ]);
  await queryBackend(backend, `INSERT INTO stage_state_history VALUES ($1,$2,$3,$4::jsonb,$5)`, [
    "demo-web",
    "staging",
    "run-1",
    JSON.stringify(stageState()),
    "2026-07-05T12:00:00.000Z",
  ]);
}

function submissionDoc() {
  return {
    submissionId: "submission-1",
    submittedAt: "2026-07-05T12:00:00.000Z",
    deploymentId: "demo-web",
    deploymentLabel: "//demo:deploy",
    operationKind: "deploy",
    lockScope: "demo-web",
    lifecycleState: "finished",
    deployRunId: "run-1",
  };
}

function runAction(actionId: string, submittedAt: string) {
  return { actionId, submissionId: "submission-1", action: "cancel", submittedAt };
}

function stageState() {
  return {
    deploymentId: "demo-web",
    environmentStage: "staging",
    currentRunId: "run-1",
    sourceRevision: "git:abc",
    artifactIdentity: "artifact-1",
    retainedRenderEvidence: [
      { kind: "execution_snapshot", referencePath: "/tmp/execution-snapshot.json" },
    ],
    retainedArtifactEvidence: [
      {
        identity: "artifact-1",
        storedArtifactPath: "/tmp/artifact.tgz",
        provenancePath: "/tmp/provenance.json",
      },
    ],
  };
}
