#!/usr/bin/env zx-wrapper
import { sanitizeName } from "../lib/sanitize";
import { providerTargetIdentityFor, type DeploymentTarget } from "./contract";
import type { DeploymentRequirement } from "./deployment-requirements";
import { requireVaultContractPath } from "./deployment-secret-vault-paths";

export const DEPLOYMENT_VAULT_SECRET_TEMPLATES_SCHEMA = "deployment-vault-secret-templates@1";

export type VaultSecretTemplateFormat = "json" | "files";
export type TargetScope = {
  value: string;
  source: "provider-target-identity" | "deploy-run-lock-scope";
};

function requireRepository(deployment: DeploymentTarget): string {
  const repository = deployment.lanePolicy.governance.repository.trim();
  if (!repository) {
    throw new Error("lane governance repository metadata is required for Vault bound claims");
  }
  return repository;
}

function secretTemplate(requirement: DeploymentRequirement, targetScope: string) {
  const vaultPath = requireVaultContractPath(requirement.contractId);
  return {
    name: requirement.name,
    contractId: requirement.contractId,
    mount: vaultPath.mount,
    secretPath: vaultPath.secretPath,
    kvDataPath: vaultPath.dataPath,
    kvMetadataPath: vaultPath.metadataPath,
    fileName: `${sanitizeName(requirement.name || vaultPath.secretPath)}.json`,
    content: {
      value: "<fill-me>",
      allowedSteps: [requirement.step],
      targetScopes: [targetScope],
      refreshMode: "none",
      credentialClass: "routine",
    },
  };
}

function baseDocument(deployment: DeploymentTarget, targetScope: TargetScope) {
  return {
    deployment: {
      deploymentId: deployment.deploymentId,
      label: deployment.label,
      provider: deployment.provider,
      environmentStage: deployment.environmentStage,
      providerTargetIdentity: providerTargetIdentityFor(deployment),
      repository: requireRepository(deployment),
    },
    targetScope,
  };
}

export function buildVaultSecretTemplatesDocument(opts: {
  deployment: DeploymentTarget;
  targetScope?: TargetScope;
}) {
  const targetScope = opts.targetScope || {
    value: providerTargetIdentityFor(opts.deployment),
    source: "provider-target-identity" as const,
  };
  const templates = opts.deployment.secretRequirements.map((requirement) =>
    secretTemplate(requirement, targetScope.value),
  );
  return {
    schemaVersion: DEPLOYMENT_VAULT_SECRET_TEMPLATES_SCHEMA,
    ...baseDocument(opts.deployment, targetScope),
    empty: templates.length === 0,
    message: templates.length === 0 ? "deployment declares no secret requirements" : undefined,
    templates,
  };
}

export function renderVaultSecretTemplatesDocument(
  document: ReturnType<typeof buildVaultSecretTemplatesDocument>,
  format: VaultSecretTemplateFormat,
): string {
  if (format === "json") return JSON.stringify(document, null, 2);
  if (document.templates.length === 0) return "# no secret templates: deployment declares none\n";
  return document.templates
    .map((template) => `# ${template.fileName}\n${JSON.stringify(template.content, null, 2)}`)
    .join("\n\n");
}
