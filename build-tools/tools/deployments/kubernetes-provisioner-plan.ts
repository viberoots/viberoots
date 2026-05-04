#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels";
import type { KubernetesDeployment } from "./contract";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";
import { OPENTOFU_STACK_PROVISIONER, readOpenTofuResolvedPlan } from "./opentofu-stack";

export const KUBERNETES_PROVISIONER_PLAN_SCHEMA = "kubernetes-provisioner-plan@1";

export type KubernetesProvisionerPlanRef = {
  artifactPath: string;
  fingerprint: string;
  mutationClass: "no_op" | "non_destructive";
  planFingerprint?: string;
  stackConfigFingerprint?: string;
};

async function openTofuPlan(opts: { workspaceRoot: string; deployment: KubernetesDeployment }) {
  if (opts.deployment.provisioner?.type !== OPENTOFU_STACK_PROVISIONER) return undefined;
  return await readOpenTofuResolvedPlan({
    workspaceRoot: opts.workspaceRoot,
    packagePath: packagePathFromLabel(opts.deployment.label),
    provisioner: opts.deployment.provisioner,
  });
}

export async function writeKubernetesProvisionerPlan(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deployRunId: string;
  deployment: KubernetesDeployment;
}): Promise<KubernetesProvisionerPlanRef | undefined> {
  if (!opts.deployment.provisioner?.type) return undefined;
  const resolvedOpenTofuPlan = await openTofuPlan(opts);
  const artifactPath = path.join(
    path.resolve(opts.recordsRoot),
    "provisioner-plans",
    `${opts.deployRunId}.json`,
  );
  const plan = {
    schemaVersion: KUBERNETES_PROVISIONER_PLAN_SCHEMA,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    provisionerType: opts.deployment.provisioner.type,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    cluster: opts.deployment.providerTarget.cluster,
    namespace: opts.deployment.providerTarget.namespace,
    release: opts.deployment.providerTarget.release,
    ...(resolvedOpenTofuPlan
      ? {
          opentofu: {
            configPath: resolvedOpenTofuPlan.configPath,
            planPath: resolvedOpenTofuPlan.planPath,
            stackDirectory: opts.deployment.provisioner.stackDirectory,
            stackIdentity: opts.deployment.provisioner.stackIdentity,
            stateBackendIdentity: opts.deployment.provisioner.stateBackendIdentity,
            stackConfigFingerprint: resolvedOpenTofuPlan.stackConfigFingerprint,
            planFingerprint: resolvedOpenTofuPlan.planFingerprint,
            summary: resolvedOpenTofuPlan.summary,
          },
        }
      : {}),
    mutationClass: resolvedOpenTofuPlan?.summary.mutationClass || ("non_destructive" as const),
  };
  await fsp.mkdir(path.dirname(artifactPath), { recursive: true });
  await fsp.writeFile(artifactPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
  return {
    artifactPath,
    fingerprint: fingerprintValue(plan),
    mutationClass: plan.mutationClass,
    ...(resolvedOpenTofuPlan
      ? {
          planFingerprint: resolvedOpenTofuPlan.planFingerprint,
          stackConfigFingerprint: resolvedOpenTofuPlan.stackConfigFingerprint,
        }
      : {}),
  };
}
