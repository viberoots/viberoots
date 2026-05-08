#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { CloudflareContainersDeployment } from "./contract";
import {
  smokeCloudflareContainersRouting,
  type CloudflareContainersSmokeConnectOverride,
} from "./cloudflare-containers-routing-smoke";
import type { DeploymentExecutionResult } from "./deployment-execution";
import { admitKubernetesComponentArtifacts } from "./kubernetes-artifacts";

function runId(): string {
  return `cf-containers-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function fileFingerprint(filePath: string): Promise<string> {
  const data = await fsp.readFile(filePath, "utf8").catch((error: any) => {
    if (error?.code === "ENOENT") {
      throw new Error(`cloudflare-containers provider config not found: ${filePath}`);
    }
    throw error;
  });
  return `sha256:${crypto.createHash("sha256").update(data).digest("hex")}`;
}

export async function submitCloudflareContainersDeploy(opts: {
  workspaceRoot: string;
  deployment: CloudflareContainersDeployment;
  recordsRoot: string;
  artifactDir: string;
  smokeConnectOverride?: CloudflareContainersSmokeConnectOverride;
}): Promise<DeploymentExecutionResult> {
  const deployRunId = runId();
  const [artifact] = await admitKubernetesComponentArtifacts({
    recordsRoot: opts.recordsRoot,
    artifactPathsByComponentId: { default: opts.artifactDir },
  });
  if (!artifact) throw new Error("missing admitted cloudflare-containers artifact");
  const configPath = path.resolve(
    opts.workspaceRoot,
    opts.deployment.label.slice(2).split(":")[0] || "",
    opts.deployment.publisher.config,
  );
  const workerConfigFingerprint = await fileFingerprint(configPath);
  const smoke = await smokeCloudflareContainersRouting({
    deployment: opts.deployment,
    ...(opts.smokeConnectOverride ? { connectOverride: opts.smokeConnectOverride } : {}),
  });
  const record = {
    deployRunId,
    operationKind: "deploy",
    runClassification: "deploy",
    finalOutcome: "succeeded",
    artifact: { identity: artifact.identity },
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    providerReleaseId: `${opts.deployment.providerTarget.worker}-${artifact.identity.slice(-12)}`,
    workerConfigFingerprint,
    publicUrl: opts.deployment.providerTarget.canonicalUrl,
    route: opts.deployment.providerTarget.domain,
    smokeUrl: smoke.smokeUrl,
    smokeOutcome: smoke.smokeOutcome,
  };
  const recordPath = path.join(opts.recordsRoot, `${deployRunId}.json`);
  await fsp.mkdir(opts.recordsRoot, { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return { record, recordPath };
}
