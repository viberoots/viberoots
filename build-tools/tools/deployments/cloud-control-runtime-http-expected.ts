import type { RuntimeHttpEvidence } from "./cloud-control-runtime-http-evidence";

export type RuntimeHttpExpectedOptions = {
  expectedDeploymentIds?: readonly string[];
  expectedWorkerCount?: number;
};

export function validateRuntimeHttpExpectedFields(
  evidence: RuntimeHttpEvidence,
  label: string,
  options: RuntimeHttpExpectedOptions,
): string[] {
  return [
    ...validateDeploymentIds(evidence, label, options.expectedDeploymentIds || []),
    ...validateWorkerCount(evidence, label, options.expectedWorkerCount),
  ];
}

function validateDeploymentIds(
  evidence: RuntimeHttpEvidence,
  label: string,
  trustedDeploymentIds: readonly string[],
): string[] {
  const deploymentIds = evidence.expected?.deploymentIds;
  if (!Array.isArray(deploymentIds) || deploymentIds.length === 0) {
    return [`${label} expected.deploymentIds missing`];
  }
  return sameStrings(deploymentIds.map(String), [...trustedDeploymentIds])
    ? []
    : [`${label} expected.deploymentIds do not match trusted runtime config`];
}

function validateWorkerCount(
  evidence: RuntimeHttpEvidence,
  label: string,
  trustedWorkerCount: number | undefined,
): string[] {
  const workerCount = evidence.expected?.workerCount;
  if (typeof workerCount !== "number" || !Number.isInteger(workerCount) || workerCount <= 0) {
    return [`${label} expected.workerCount missing`];
  }
  return workerCount === trustedWorkerCount
    ? []
    : [`${label} expected.workerCount does not match trusted runtime config`];
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
