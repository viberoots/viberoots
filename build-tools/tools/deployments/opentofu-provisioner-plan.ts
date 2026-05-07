#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels";
import type { OpenTofuDeployment } from "./contract";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";
import { readOpenTofuResolvedPlan } from "./opentofu-stack";
import type { KubernetesProvisionerPlanRef } from "./kubernetes-provisioner-plan";

export const OPENTOFU_PROVISIONER_PLAN_SCHEMA = "opentofu-provisioner-plan@1";

export async function writeOpenTofuProvisionerPlan(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deployRunId: string;
  deployment: OpenTofuDeployment;
}): Promise<KubernetesProvisionerPlanRef> {
  const resolved = await readOpenTofuResolvedPlan({
    workspaceRoot: opts.workspaceRoot,
    packagePath: packagePathFromLabel(opts.deployment.label),
    provisioner: opts.deployment.provisioner,
  });
  const artifactPath = path.join(
    path.resolve(opts.recordsRoot),
    "provisioner-plans",
    `${opts.deployRunId}.json`,
  );
  const plan = {
    schemaVersion: OPENTOFU_PROVISIONER_PLAN_SCHEMA,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    provisionerType: opts.deployment.provisioner.type,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    opentofu: {
      configPath: resolved.configPath,
      planJsonPath: resolved.planJsonPath,
      applyPlanPath: resolved.applyPlanPath,
      stackDirectory: opts.deployment.provisioner.stackDirectory,
      stackIdentity: opts.deployment.provisioner.stackIdentity,
      stateBackendIdentity: opts.deployment.provisioner.stateBackendIdentity,
      stackConfigFingerprint: resolved.stackConfigFingerprint,
      planFingerprint: resolved.planFingerprint,
      summary: resolved.summary,
    },
    mutationClass: resolved.summary.mutationClass,
  };
  await fsp.mkdir(path.dirname(artifactPath), { recursive: true });
  await fsp.writeFile(artifactPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
  return {
    artifactPath,
    fingerprint: fingerprintValue(plan),
    mutationClass: plan.mutationClass,
    planFingerprint: resolved.planFingerprint,
    stackConfigFingerprint: resolved.stackConfigFingerprint,
  };
}
