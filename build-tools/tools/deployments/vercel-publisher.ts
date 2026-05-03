#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { VercelDeployment } from "./contract.ts";
import type { AdmittedVercelPrebuiltArtifact } from "./vercel-artifacts.ts";
import { requireAdmittedVercelArtifactPath } from "./vercel-artifacts.ts";
import { createFakeVercelApiClient, type VercelApiClient } from "./vercel-api.ts";
import { prepareVercelPublisherConfig } from "./vercel-config.ts";

export type VercelPublishResult = {
  providerReleaseId: string;
  publicUrl: string;
  aliasAssigned: boolean;
};

export async function publishVercelPrebuilt(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  runId: string;
  deployment: VercelDeployment;
  artifact: AdmittedVercelPrebuiltArtifact;
  apiToken: string;
  sourceRunId?: string;
  apiClient?: VercelApiClient;
}): Promise<VercelPublishResult & { providerConfigFingerprint: string }> {
  if (!opts.apiToken.trim()) throw new Error("vercel publish requires a secret-runtime API token");
  const outputDir = await requireAdmittedVercelArtifactPath(opts.artifact);
  const preparedConfig = await prepareVercelPublisherConfig({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    outputPath: path.join(opts.recordsRoot, "provider-config", `${opts.runId}.vercel.json`),
  });
  const target = opts.deployment.providerTarget;
  const result = await (opts.apiClient || createFakeVercelApiClient()).publishPrebuilt({
    team: target.team,
    project: target.project,
    environment: target.environment,
    artifactIdentity: opts.artifact.identity,
    outputDir,
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
  });
  return {
    providerReleaseId: result.deploymentId,
    publicUrl: result.url || target.canonicalUrl,
    aliasAssigned: result.aliasAssigned,
    providerConfigFingerprint: preparedConfig.fingerprint,
  };
}

export async function cleanupVercelPreview(opts: {
  deployment: VercelDeployment;
  sourceRunId: string;
  apiToken: string;
  apiClient?: VercelApiClient;
}) {
  if (!opts.apiToken.trim()) throw new Error("vercel preview cleanup requires an API token");
  const cleanup = (opts.apiClient || createFakeVercelApiClient()).cleanupPreview;
  if (!cleanup) throw new Error("vercel API client does not support preview cleanup");
  return await cleanup({
    team: opts.deployment.providerTarget.team,
    project: opts.deployment.providerTarget.project,
    sourceRunId: opts.sourceRunId,
  });
}
