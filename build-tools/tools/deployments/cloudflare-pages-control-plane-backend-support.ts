#!/usr/bin/env zx-wrapper
import { resolveCloudflarePagesArtifactInput } from "./cloudflare-pages-artifact-input.ts";
import type { ResolvedCloudflarePagesServiceSubmitRequest } from "./cloudflare-pages-control-plane-service-submit.ts";
import { workerVaultRuntimeMetadata } from "./deployment-vault-runtime-worker.ts";

export function vaultRuntimeForCloudflareDeployment(
  deployment: ResolvedCloudflarePagesServiceSubmitRequest["request"]["deployment"],
) {
  const vaultRuntime = workerVaultRuntimeMetadata({ deployment });
  return vaultRuntime ? { vaultRuntime } : {};
}

export async function resolveCloudflarePagesArtifactForSubmission(
  resolved: Extract<ResolvedCloudflarePagesServiceSubmitRequest, { kind: "deploy" | "promotion" }>,
  opts: { workspaceRoot: string; recordsRoot: string },
) {
  return await resolveCloudflarePagesArtifactInput({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployment: resolved.request.deployment,
    submissionId: resolved.request.submissionId,
    artifactInput: resolved.artifactInput!,
  });
}
