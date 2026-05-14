#!/usr/bin/env zx-wrapper
import { redactDeploymentAuthJson } from "./deployment-auth-redaction";
import type { DeploymentTarget } from "./contract";
import { deploymentSecretContractBindings } from "./deployment-sprinkle-ref";

export const DEPLOYMENT_AUTH_SECRET_BACKEND_SCHEMA = "deployment-auth-secret-backend@1";
export const DEPLOYMENT_AUTH_INFISICAL_IDENTITY_SCHEMA = "deployment-auth-infisical-identity@1";

function deploymentSummary(deployment: DeploymentTarget) {
  return {
    deploymentId: deployment.deploymentId,
    label: deployment.label,
    provider: deployment.provider,
    environmentStage: deployment.environmentStage,
    protectionClass: deployment.protectionClass,
  };
}

function infisicalRuntimeSummary(deployment: DeploymentTarget) {
  const runtime = deployment.infisicalRuntime;
  if (!runtime) return undefined;
  return {
    siteUrl: runtime.siteUrl,
    projectId: runtime.projectId,
    environment: runtime.environment,
    secretPath: runtime.secretPath || "/",
    machineIdentityId: runtime.machineIdentityId,
    machineIdentityClientIdEnv: runtime.machineIdentityClientIdEnv,
    machineIdentityClientSecretEnv: runtime.machineIdentityClientSecretEnv,
    credentialSourceName: "infisical_machine_identity_universal_auth",
  };
}

export function buildDeploymentSecretBackendExplanation(deployment: DeploymentTarget) {
  const bindings = deploymentSecretContractBindings(
    deployment.secretRequirements,
    deployment.secretBackend || "vault",
  );
  return redactDeploymentAuthJson({
    schemaVersion: DEPLOYMENT_AUTH_SECRET_BACKEND_SCHEMA,
    deployment: deploymentSummary(deployment),
    readOnly: true,
    providerMutation: false,
    tokensMinted: false,
    secretValuesRead: false,
    backendKind: deployment.secretBackend || "vault",
    infisicalRuntime: infisicalRuntimeSummary(deployment),
    contracts: bindings.map((binding) => ({
      contractId: binding.contractId,
      name: binding.name,
      step: binding.step,
      required: binding.required,
      backend: binding.backend,
    })),
  });
}

export function buildDeploymentInfisicalIdentityExplanation(
  deployment: DeploymentTarget,
  env: NodeJS.ProcessEnv = process.env,
) {
  const runtime = deployment.infisicalRuntime;
  const missingEnvVarNames = [
    runtime?.machineIdentityClientIdEnv,
    runtime?.machineIdentityClientSecretEnv,
  ]
    .filter((name): name is string => Boolean(name))
    .filter((name) => !String(env[name] || "").trim());
  return redactDeploymentAuthJson({
    schemaVersion: DEPLOYMENT_AUTH_INFISICAL_IDENTITY_SCHEMA,
    deployment: deploymentSummary(deployment),
    readOnly: true,
    providerMutation: false,
    tokensMinted: false,
    secretValuesRead: false,
    backendKind: deployment.secretBackend || "vault",
    supported: deployment.secretBackend === "infisical",
    credentialSourceName: "infisical_machine_identity_universal_auth",
    runtime: infisicalRuntimeSummary(deployment),
    missingEnvVarNames,
  });
}
