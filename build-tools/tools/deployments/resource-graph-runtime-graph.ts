#!/usr/bin/env zx-wrapper
import { publicCurrentStageState } from "./deployment-current-stage-state-public";
import type { ResourceGraphEdge, ResourceGraphNode } from "./resource-graph-export";
import { normalizeProviderEvidenceFacts } from "./resource-graph-provider-evidence";
import {
  provisionerRuntimeEdges,
  retainedRenderEvidence,
} from "./resource-graph-runtime-provisioner";
import { ADMITTED_RUNTIME_SOURCE_LABEL } from "./resource-graph-types";
import { decodeBackendJson } from "./nixos-shared-host-control-plane-backend-db";

type JsonRow = Record<string, unknown>;

const runtimeSource = { class: "runtime" as const, label: ADMITTED_RUNTIME_SOURCE_LABEL };

export class RuntimeGraph {
  nodes: ResourceGraphNode[] = [];
  edges: ResourceGraphEdge[] = [];
  private submissions: Map<string, any>;
  private context: any;

  constructor(context: any, submissions: JsonRow[]) {
    this.context = context;
    this.submissions = new Map(
      submissions.map((row) => [String(row.submission_id), decode(row.document_json)]),
    );
  }

  snapshot(row: JsonRow) {
    const submissionId = String(row.submission_id);
    this.node("ExecutionSnapshot", submissionId, {
      submissionId,
      executionSnapshotPath: row.execution_snapshot_path,
    });
    this.edgeToDeployment("ExecutionSnapshot", submissionId, this.submissions.get(submissionId));
  }

  deployRun(row: JsonRow) {
    const runId = String(row.deploy_run_id);
    const doc = decode(row.document_json);
    this.node("DeployRun", runId, { ...doc, recordPath: row.record_path });
    this.edgeToDeployment("DeployRun", runId, doc);
    if (doc.providerTargetIdentity || doc.provider) {
      this.node(
        "ProviderEvidence",
        runId,
        normalizeProviderEvidenceFacts({
          ...doc,
          executionSnapshotSubmissionId: row.submission_id,
        }),
      );
      this.edge("ProviderEvidence", runId, "DeployRun", runId, "runtime_status");
      this.edge(
        "ProviderEvidence",
        runId,
        "ExecutionSnapshot",
        String(row.submission_id),
        "runtime_status",
      );
      this.edgeToDeployment("ProviderEvidence", runId, doc);
      const targetUid = this.context.providerTargetUidById.get(String(doc.providerTargetIdentity));
      if (targetUid) {
        this.edges.push({
          fromUid: uid("ProviderEvidence", runId),
          toUid: targetUid,
          kind: "provider_target",
          fromKind: "ProviderEvidence",
          toKind: "ProviderTarget",
        } as ResourceGraphEdge);
      }
    }
    this.addProvisionerEdges(doc, "DeployRun", runId);
    this.addProvisionerEdges(doc, "ExecutionSnapshot", String(row.submission_id));
  }

  runAction(row: JsonRow) {
    const actionId = String(row.action_id);
    const request = decode(row.request_json);
    this.node("RunAction", actionId, {
      actionId,
      submissionId: row.submission_id,
      action: row.action,
      submittedAt: request.submittedAt,
    });
    this.edgeToDeployment("RunAction", actionId, this.submissions.get(String(row.submission_id)));
  }

  stageState(row: JsonRow) {
    const doc = publicCurrentStageState(decode(row.document_json) as never);
    const name = `${row.deployment_id}:${row.environment_stage}`;
    this.node("CurrentStageState", name, doc);
    this.edgeToDeployment("CurrentStageState", name, doc);
    const providerEvidence = this.providerEvidenceFacts(String(doc.currentRunId || ""));
    if (providerEvidence) {
      this.edge(
        "ProviderEvidence",
        String(doc.currentRunId),
        "CurrentStageState",
        name,
        "evidence",
      );
      providerEvidence.retainedRenderEvidence = retainedRenderEvidence(doc.retainedRenderEvidence);
      providerEvidence.retainedArtifactEvidence = doc.retainedArtifactEvidence || [];
    }
    this.addProvisionerEdges(doc, "CurrentStageState", name);
    for (const evidence of [
      ...retainedRenderEvidence(doc.retainedRenderEvidence),
      ...(doc.retainedArtifactEvidence || []),
    ]) {
      const evidenceId = `${name}:${evidence.kind || evidence.identity}`;
      this.node("RetainedEvidence", evidenceId, evidence);
      this.edge("RetainedEvidence", evidenceId, "CurrentStageState", name, "evidence");
    }
  }

  stageHistory(row: JsonRow) {
    const name = `${row.deployment_id}:${row.environment_stage}:${row.deploy_run_id}`;
    const doc = decode(row.document_json);
    this.node("StageHistoryEntry", name, doc);
    this.edgeToDeployment("StageHistoryEntry", name, doc);
  }

  challenge(row: JsonRow) {
    const id = String(row.challenge_id);
    const binding = decode(row.binding_json);
    const consumed = Boolean(row.used_at);
    this.node("ArtifactChallenge", id, {
      challengeId: id,
      deploymentId: binding.request?.deployment?.deploymentId || binding.request?.deploymentId,
      principalId: row.principal_id,
      proofKeyId: row.key_id,
      expiresAtMs: row.expires_at_ms,
      status: consumed ? "accepted" : "issued",
      nonceValidationOutcome: consumed ? "matched-redacted-nonce-digest" : "pending",
      proofKeyValidationOutcome: consumed ? "trusted-key" : "pending",
      oneTimeConsumption: consumed ? "consumed-once" : "not-yet-consumed",
      admittedProvenance:
        binding.finalizedStagedArtifactReference || binding.request?.artifactIdentity || "pending",
      ...(!consumed ? { failureDiagnostics: "not yet consumed" } : {}),
      binding,
    });
  }

  uploadSession(row: JsonRow) {
    const id = String(row.upload_session_id);
    const doc = decode(row.document_json);
    this.node("StaticWebappUploadSession", id, {
      uploadSessionId: id,
      submissionId: row.submission_id,
      archiveFormat: doc.archiveFormat,
      archivePath: doc.archivePath,
      objectIdentity: doc.archiveObject?.key,
      digest: doc.archiveDigest || doc.digest,
      sizeBytes: doc.sizeBytes,
      expiresAt: row.expires_at,
      provenance: `upload-session:${id}`,
      document: doc,
    });
    this.edgeToDeployment(
      "StaticWebappUploadSession",
      id,
      this.submissions.get(String(row.submission_id)),
    );
  }

  cleanup(row: JsonRow) {
    const id = String(row.record_id);
    this.node("CleanupEvidence", id, {
      recordId: id,
      submissionId: row.submission_id,
      deploymentId: row.deployment_id,
      reason: row.reason,
      status: "rejected",
      diagnostics: decode(row.document_json).cleanupError,
      documentJson: decode(row.document_json),
      createdAt: row.created_at,
    });
    const toUid = this.context.deploymentUidById.get(String(row.deployment_id || ""));
    if (toUid) this.edge("CleanupEvidence", id, "Deployment", toUid, "runtime_status", true);
  }

  artifact(row: JsonRow) {
    const id = String(row.object_key);
    this.node("StagedArtifact", id, {
      objectKey: id,
      bucket: row.bucket,
      digest: row.digest,
      sizeBytes: row.size_bytes,
      contentType: row.content_type,
      provenance: decode(row.provenance_json),
    });
  }

  private node(kind: string, name: string, facts: Record<string, unknown>) {
    this.nodes.push({
      uid: uid(kind, name),
      kind,
      name,
      source: runtimeSource,
      labels: { "viberoots.dev/authority": "observed_runtime" },
      statusRef: `status:${uid(kind, name)}`,
      evidenceRef: `evidence:${uid(kind, name)}`,
      facts,
    } as ResourceGraphNode);
  }

  private edgeToDeployment(fromKind: string, name: string, doc: any) {
    const deploymentId = String(doc?.deploymentId || "");
    const toUid = this.context.deploymentUidById.get(deploymentId);
    if (toUid) this.edge(fromKind, name, "Deployment", toUid, "runtime_status", true);
  }

  private edge(
    fromKind: string,
    name: string,
    toKind: string,
    to: string,
    kind: string,
    rawTo = false,
  ) {
    this.edges.push({
      fromUid: uid(fromKind, name),
      toUid: rawTo ? to : uid(toKind, to),
      kind,
      fromKind,
      toKind,
    } as ResourceGraphEdge);
  }

  private providerEvidenceFacts(runId: string) {
    return this.nodes.find((node) => node.uid === uid("ProviderEvidence", runId))?.facts;
  }

  private addProvisionerEdges(doc: any, toKind: string, to: string) {
    this.edges.push(
      ...provisionerRuntimeEdges({
        doc,
        toKind,
        to,
        provisionerUidByDeploymentId: this.context.provisionerUidByDeploymentId,
      }),
    );
  }
}

const decode = (value: unknown): any => (value ? decodeBackendJson(value) : {});

const uid = (kind: string, name: string) => `runtime:${kind}:${name}`;
