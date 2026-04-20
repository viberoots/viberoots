#!/usr/bin/env zx-wrapper
import { sanitizeName } from "../lib/sanitize.ts";
import { providerTargetIdentityFor, type DeploymentTarget } from "./contract.ts";
import type { DeploymentRequirement } from "./deployment-requirements.ts";
import { requireVaultContractPath } from "./deployment-secret-vault-paths.ts";

export const DEPLOYMENT_VAULT_BOOTSTRAP_SCHEMA = "deployment-vault-bootstrap@1";
export const DEPLOYMENT_VAULT_SECRET_TEMPLATES_SCHEMA = "deployment-vault-secret-templates@1";

export type VaultBootstrapFormat = "json" | "shell" | "hcl" | "markdown";
export type VaultSecretTemplateFormat = "json" | "files";

export type VaultBootstrapInputs = {
  issuerUrl?: string | undefined;
  audience?: string | undefined;
  deploymentClientId?: string | undefined;
  roleName?: string | undefined;
  policyName?: string | undefined;
  extraBoundClaims?: Record<string, string> | undefined;
};

type TargetScope = { value: string; source: "provider-target-identity" | "deploy-run-lock-scope" };

function defaultPolicyName(deployment: DeploymentTarget): string {
  const stageSuffix = deployment.environmentStage ? `-${deployment.environmentStage}` : "";
  const base =
    stageSuffix && deployment.deploymentId.endsWith(stageSuffix)
      ? deployment.deploymentId.slice(0, -stageSuffix.length)
      : deployment.deploymentId;
  return `deploy-${sanitizeName(base)}-read`;
}

function requireRepository(deployment: DeploymentTarget): string {
  const repository = deployment.lanePolicy.governance.repository.trim();
  if (!repository) {
    throw new Error("lane governance repository metadata is required for Vault bound claims");
  }
  return repository;
}

function sortedObject(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
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

function bootstrapInputs(opts: { deployment: DeploymentTarget; inputs: VaultBootstrapInputs }) {
  const metadata = opts.deployment.vaultRuntime;
  const policyName =
    opts.inputs.policyName?.trim() ||
    metadata?.roleName?.trim() ||
    defaultPolicyName(opts.deployment);
  const roleName = opts.inputs.roleName?.trim() || metadata?.roleName?.trim() || policyName;
  const clientId = opts.inputs.deploymentClientId?.trim() || metadata?.deploymentClientId?.trim();
  const claims = sortedObject({
    ...(clientId ? { azp: clientId } : {}),
    deployment_environment: opts.deployment.environmentStage,
    repository: requireRepository(opts.deployment),
    ...(opts.inputs.extraBoundClaims || {}),
  });
  return { policyName, roleName, claims };
}

export function buildVaultBootstrapDocument(opts: {
  deployment: DeploymentTarget;
  inputs?: VaultBootstrapInputs;
  targetScope?: TargetScope;
}) {
  if (opts.deployment.secretRequirements.length === 0) {
    throw new Error("Vault bootstrap output requires at least one secret requirement");
  }
  const inputs = opts.inputs || {};
  const targetScope = opts.targetScope || {
    value: providerTargetIdentityFor(opts.deployment),
    source: "provider-target-identity" as const,
  };
  const templates = buildVaultSecretTemplatesDocument({
    deployment: opts.deployment,
    targetScope,
  }).templates;
  const normalized = bootstrapInputs({ deployment: opts.deployment, inputs });
  const policyHcl = [...new Set(templates.map((template) => template.kvDataPath))]
    .sort((a, b) => a.localeCompare(b))
    .map((kvDataPath) => `path "${kvDataPath}" {\n  capabilities = ["read"]\n}`)
    .join("\n\n");
  return {
    schemaVersion: DEPLOYMENT_VAULT_BOOTSTRAP_SCHEMA,
    ...baseDocument(opts.deployment, targetScope),
    vault: {
      issuerUrl: inputs.issuerUrl || opts.deployment.vaultRuntime?.oidcIssuer || "<issuer-url>",
      audience: inputs.audience || opts.deployment.vaultRuntime?.audience || "<vault-audience>",
      deploymentClientId:
        inputs.deploymentClientId ||
        opts.deployment.vaultRuntime?.deploymentClientId ||
        "<deployment-client-id>",
      roleName: normalized.roleName,
      policyName: normalized.policyName,
      boundClaims: normalized.claims,
    },
    policyHcl,
    secretTemplates: templates,
    runtimeEnvironment: {
      VAULT_ADDR: opts.deployment.vaultRuntime?.addr || "<vault-addr>",
      BNX_VAULT_OIDC_ISSUER:
        inputs.issuerUrl || opts.deployment.vaultRuntime?.oidcIssuer || "<issuer-url>",
      [opts.deployment.vaultRuntime?.clientSecretEnv || "BNX_DEPLOYER_CLIENT_SECRET"]:
        "<client-secret>",
    },
    warnings: [
      "Vault initialization, unseal, root-token custody, and real secret entry remain manual operator actions.",
      "issuerUrl, audience, deploymentClientId, roleName, and extra bound claims are operator-owned inputs.",
    ],
  };
}

export function assertVaultBootstrapExecutableDocument(
  document: ReturnType<typeof buildVaultBootstrapDocument>,
) {
  for (const [field, value] of [
    ["issuerUrl", document.vault.issuerUrl],
    ["audience", document.vault.audience],
    ["deploymentClientId", document.vault.deploymentClientId],
    ["roleName", document.vault.roleName],
  ]) {
    if (!value.trim() || value.startsWith("<")) {
      throw new Error(`Vault bootstrap executable output requires vault.${field}`);
    }
  }
}

export function renderVaultBootstrapDocument(
  document: ReturnType<typeof buildVaultBootstrapDocument>,
  format: VaultBootstrapFormat,
): string {
  if (format === "json") return JSON.stringify(document, null, 2);
  if (format === "hcl") return `${document.policyHcl}\n`;
  const claims = JSON.stringify(document.vault.boundClaims);
  const auth = [
    "vault write auth/jwt/config \\",
    `  oidc_discovery_url=${shellQuote(document.vault.issuerUrl)} \\`,
    `  bound_issuer=${shellQuote(document.vault.issuerUrl)}`,
  ].join("\n");
  const role = [
    `vault write auth/jwt/role/${document.vault.roleName} \\`,
    '  role_type="jwt" \\',
    `  bound_audiences=${shellQuote(document.vault.audience)} \\`,
    `  bound_claims=${shellQuote(claims)} \\`,
    '  user_claim="sub" \\',
    `  token_policies=${shellQuote(document.vault.policyName)} \\`,
    '  token_ttl="30m" \\',
    '  token_max_ttl="2h"',
  ].join("\n");
  if (format === "shell") {
    const clientSecretEnv =
      Object.keys(document.runtimeEnvironment).find(
        (key) => key !== "VAULT_ADDR" && key !== "BNX_VAULT_OIDC_ISSUER",
      ) || "BNX_DEPLOYER_CLIENT_SECRET";
    return [
      auth,
      `cat > ${document.vault.policyName}.hcl <<'HCL'\n${document.policyHcl}\nHCL`,
      `vault policy write ${document.vault.policyName} ${document.vault.policyName}.hcl`,
      role,
      `export VAULT_ADDR=${shellQuote(document.runtimeEnvironment.VAULT_ADDR)}`,
      `export BNX_VAULT_OIDC_ISSUER=${shellQuote(document.runtimeEnvironment.BNX_VAULT_OIDC_ISSUER)}`,
      `export ${clientSecretEnv}='<client-secret>'`,
    ].join("\n\n");
  }
  return [
    `# Vault bootstrap for ${document.deployment.label}`,
    "## JWT auth config",
    "```bash",
    auth,
    "```",
    "## Read policy",
    "```hcl",
    document.policyHcl,
    "```",
    "## JWT role",
    "```bash",
    role,
    "```",
  ].join("\n");
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
