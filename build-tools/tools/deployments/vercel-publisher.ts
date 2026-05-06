#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { VercelDeployment } from "./contract";
import type { AdmittedVercelPrebuiltArtifact } from "./vercel-artifacts";
import { requireAdmittedVercelArtifactPath } from "./vercel-artifacts";
import {
  createFakeVercelApiClient,
  createLiveVercelApiClient,
  type VercelApiClient,
} from "./vercel-api";
import { prepareVercelPublisherConfig, type VercelPublisherConfig } from "./vercel-config";

export type VercelPublishResult = {
  providerReleaseId: string;
  publicUrl: string;
  aliasAssigned: boolean;
};

function configuredAlias(deployment: VercelDeployment): string[] {
  if (deployment.providerTarget.environment === "preview") return [];
  try {
    return [new URL(deployment.providerTarget.canonicalUrl).hostname].filter(Boolean);
  } catch {
    return [];
  }
}

function resolveVercelClient(opts: {
  deployment: VercelDeployment;
  apiToken: string;
  preparedConfig: VercelPublisherConfig;
  apiClient?: VercelApiClient;
}): VercelApiClient {
  if (opts.apiClient) return opts.apiClient;
  const mode =
    opts.preparedConfig.clientMode ||
    (opts.deployment.protectionClass === "local_only" ? "fake" : "live");
  if (mode === "fake") {
    if (opts.deployment.protectionClass !== "local_only") {
      throw new Error("vercel fake publisher is allowed only for local_only deployments");
    }
    return createFakeVercelApiClient();
  }
  return createLiveVercelApiClient({
    apiToken: opts.apiToken,
    ...(opts.preparedConfig.apiBaseUrl ? { baseUrl: opts.preparedConfig.apiBaseUrl } : {}),
    ...(opts.preparedConfig.pollAttempts ? { pollAttempts: opts.preparedConfig.pollAttempts } : {}),
    ...(opts.preparedConfig.pollIntervalMs !== undefined
      ? { pollIntervalMs: opts.preparedConfig.pollIntervalMs }
      : {}),
  });
}

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
  const result = await resolveVercelClient({
    deployment: opts.deployment,
    apiToken: opts.apiToken,
    preparedConfig,
    ...(opts.apiClient ? { apiClient: opts.apiClient } : {}),
  }).publishPrebuilt({
    team: target.team,
    project: target.project,
    environment: target.environment,
    artifactIdentity: opts.artifact.identity,
    outputDir,
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
    aliases: configuredAlias(opts.deployment),
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
  providerDeploymentId?: string;
  apiClient?: VercelApiClient;
}) {
  if (!opts.apiToken.trim()) throw new Error("vercel preview cleanup requires an API token");
  const client =
    opts.apiClient ||
    (opts.deployment.protectionClass === "local_only"
      ? createFakeVercelApiClient()
      : createLiveVercelApiClient({ apiToken: opts.apiToken }));
  const cleanup = client.cleanupPreview;
  if (!cleanup) throw new Error("vercel API client does not support preview cleanup");
  return await cleanup({
    team: opts.deployment.providerTarget.team,
    project: opts.deployment.providerTarget.project,
    sourceRunId: opts.sourceRunId,
    ...(opts.providerDeploymentId ? { providerDeploymentId: opts.providerDeploymentId } : {}),
  });
}
