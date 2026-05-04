import type {
  CloudflarePagesDeployment,
  DeploymentRequirement,
  NixosSharedHostDeployment,
} from "../../deployments/contract";
import type { ReviewedDeployment } from "./deployment-targets.install.fragments";

export function renderStringList(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

export function renderStringDictLines(values: Record<string, string>, indent = "    "): string[] {
  return [
    `${indent}{`,
    ...Object.entries(values).map(
      ([key, value]) => `${indent}    ${JSON.stringify(key)}: ${JSON.stringify(String(value))},`,
    ),
    `${indent}},`,
  ];
}

export function renderStringRecordList(
  values: ReadonlyArray<Record<string, string>>,
  indent = "    ",
): string[] {
  if (values.length === 0) return [`${indent}[],`];
  return [
    `${indent}[`,
    ...values.flatMap((value) => renderStringDictLines(value, `${indent}    `)),
    `${indent}],`,
  ];
}

export function renderRequirementList(
  requirements: DeploymentRequirement[],
): Record<string, string>[] {
  return requirements.map((requirement) => ({
    name: requirement.name,
    step: requirement.step,
    contract_id: requirement.contractId,
    required: requirement.required ? "true" : "false",
    ...(requirement.source ? { source: requirement.source } : {}),
    ...(requirement.previewVariant ? { preview_variant: requirement.previewVariant } : {}),
    ...(requirement.notes ? { notes: requirement.notes } : {}),
  }));
}

export function renderSmokeLines(smoke: ReviewedDeployment["smoke"], indent = "    "): string[] {
  if (!smoke) return [];
  const smokeFields: Record<string, string> = {};
  if (smoke.runnerClass) smokeFields.runner_class = smoke.runnerClass;
  if (smoke.timeoutBudgetMs !== undefined) {
    smokeFields.timeout_budget_ms = String(smoke.timeoutBudgetMs);
  }
  const lines: string[] = [];
  if (Object.keys(smokeFields).length > 0) {
    lines.push(`${indent}smoke = {`);
    for (const [key, value] of Object.entries(smokeFields)) {
      lines.push(`${indent}    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    }
    lines.push(`${indent}},`);
  }
  if (smoke.exception) {
    const exceptionFields: Record<string, string> = {
      owner: smoke.exception.owner,
      reason: smoke.exception.reason,
      scope: smoke.exception.scope,
      ...(smoke.exception.reviewBy ? { review_by: smoke.exception.reviewBy } : {}),
      ...(smoke.exception.expiresAt ? { expires_at: smoke.exception.expiresAt } : {}),
      ...(smoke.exception.downgradeMode ? { downgrade_mode: smoke.exception.downgradeMode } : {}),
    };
    lines.push(`${indent}smoke_exception = {`);
    for (const [key, value] of Object.entries(exceptionFields)) {
      lines.push(`${indent}    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    }
    lines.push(`${indent}},`);
  }
  return lines;
}

export function renderPreviewLines(
  deployment: CloudflarePagesDeployment,
  indent = "    ",
): string[] {
  if (!deployment.preview) return [];
  return [
    `${indent}preview = {`,
    `${indent}    "target_derivation": ${JSON.stringify(deployment.preview.targetDerivation)},`,
    `${indent}    "isolation_class": ${JSON.stringify(deployment.preview.isolationClass)},`,
    `${indent}    "identity_selector": ${JSON.stringify(deployment.preview.identitySelector)},`,
    `${indent}    "cleanup_ttl": ${JSON.stringify(deployment.preview.cleanupTtl)},`,
    `${indent}    "smoke_target": ${JSON.stringify(deployment.preview.smokeTarget)},`,
    `${indent}    "lock_scope": ${JSON.stringify(deployment.preview.lockScope)},`,
    `${indent}},`,
  ];
}

export function renderBootstrapLines(
  deployment: NixosSharedHostDeployment,
  indent = "    ",
): string[] {
  if (!deployment.bootstrap) return [];
  return [
    `${indent}bootstrap = {`,
    `${indent}    "scope": ${JSON.stringify(deployment.bootstrap.scope)},`,
    `${indent}    "allow_first_install": ${JSON.stringify(
      deployment.bootstrap.modes.includes("first_install") ? "true" : "false",
    )},`,
    `${indent}    "allow_offline_recovery": ${JSON.stringify(
      deployment.bootstrap.modes.includes("offline_recovery") ? "true" : "false",
    )},`,
    `${indent}},`,
  ];
}

export function renderPrerequisiteList(
  deployment: Pick<ReviewedDeployment, "prerequisites">,
): Record<string, string>[] {
  return deployment.prerequisites.map((prerequisite) => ({
    deployment_id: prerequisite.deploymentId,
    mode: prerequisite.mode,
  }));
}
