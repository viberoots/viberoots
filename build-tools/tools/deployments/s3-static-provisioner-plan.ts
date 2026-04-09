#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { S3StaticDeployment } from "./contract.ts";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint.ts";

export const S3_STATIC_PROVISIONER_PLAN_SCHEMA = "s3-static-provisioner-plan@1";

export type S3StaticProvisionerPlanRef = {
  artifactPath: string;
  fingerprint: string;
  mutationClass: "non_destructive";
};

export async function writeS3StaticProvisionerPlan(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: S3StaticDeployment;
}): Promise<S3StaticProvisionerPlanRef | undefined> {
  if (!opts.deployment.provisioner?.type) return undefined;
  const artifactPath = path.join(
    path.resolve(opts.recordsRoot),
    "provisioner-plans",
    `${opts.deployRunId}.json`,
  );
  const plan = {
    schemaVersion: S3_STATIC_PROVISIONER_PLAN_SCHEMA,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    provisionerType: opts.deployment.provisioner.type,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    bucket: opts.deployment.providerTarget.bucket,
    region: opts.deployment.providerTarget.region,
    ...(opts.deployment.providerTarget.distribution
      ? { distribution: opts.deployment.providerTarget.distribution }
      : {}),
    mutationClass: "non_destructive" as const,
  };
  await fsp.mkdir(path.dirname(artifactPath), { recursive: true });
  await fsp.writeFile(artifactPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
  return {
    artifactPath,
    fingerprint: fingerprintValue(plan),
    mutationClass: "non_destructive",
  };
}
