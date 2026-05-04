#!/usr/bin/env zx-wrapper
import { readVersionedJson } from "./deployment-schema-compat";
import { KUBERNETES_RECORD_SCHEMA, type KubernetesDeployRecord } from "./kubernetes-records";

export async function readKubernetesDeployRecord(
  recordPath: string,
): Promise<KubernetesDeployRecord> {
  return await readVersionedJson(recordPath, {
    kind: "kubernetes deploy record",
    currentSchemaVersion: KUBERNETES_RECORD_SCHEMA,
    validateCurrent: (raw): raw is KubernetesDeployRecord =>
      typeof raw.deployRunId === "string" && typeof raw.deploymentLabel === "string",
  });
}
