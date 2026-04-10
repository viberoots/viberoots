#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { KubernetesDeployment } from "./contract.ts";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint.ts";

export const KUBERNETES_PROVISIONER_PLAN_SCHEMA = "kubernetes-provisioner-plan@1";

export type KubernetesProvisionerPlanRef = {
  artifactPath: string;
  fingerprint: string;
  mutationClass: "non_destructive";
};

export async function writeKubernetesProvisionerPlan(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: KubernetesDeployment;
}): Promise<KubernetesProvisionerPlanRef | undefined> {
  if (!opts.deployment.provisioner?.type) return undefined;
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
