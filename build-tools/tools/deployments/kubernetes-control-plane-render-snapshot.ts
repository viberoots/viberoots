#!/usr/bin/env zx-wrapper
import type { KubernetesControlPlaneSubmitRequest } from "./kubernetes-control-plane";
import type { AdmittedKubernetesComponentArtifact } from "./kubernetes-artifacts";
import {
  prepareKubernetesPublisherConfig,
  readPreparedKubernetesPublisherConfigSnapshot,
} from "./kubernetes-config";

export async function prepareKubernetesControlPlaneRenderSnapshot(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  request: KubernetesControlPlaneSubmitRequest;
  replay: Record<string, any>;
  componentArtifacts?: AdmittedKubernetesComponentArtifact[];
}) {
  if (!opts.componentArtifacts) return undefined;
  if (
    (opts.request.operationKind === "retry" || opts.request.operationKind === "rollback") &&
    opts.replay.replaySnapshot?.providerConfigSnapshotPath
  ) {
    return await readPreparedKubernetesPublisherConfigSnapshot(
      opts.replay.replaySnapshot.providerConfigSnapshotPath,
    );
  }
  return await prepareKubernetesPublisherConfig({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.request.deployment,
    componentArtifacts: Object.fromEntries(
      opts.componentArtifacts.map((artifact) => [
        artifact.componentId,
        { path: artifact.storedArtifactPath, identity: artifact.identity },
      ]),
    ),
    outputPath: providerConfigSnapshotPath(opts.recordsRoot, opts.request.submissionId),
  });
}

function providerConfigSnapshotPath(recordsRoot: string, submissionId: string): string {
  return `${recordsRoot}/provider-config/${submissionId}.helm-values.json`;
}
