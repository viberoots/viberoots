#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import type { InfisicalCredentialConfig } from "./deployment-secret-infisical-credentials";
import { resolveInfisicalCredentialFromRuntime } from "./deployment-secret-infisical-runtime-credentials";
import {
  checkInfisicalAdminDiagnostic,
  infisicalAdminDiagnostic,
  infisicalAdminDiagnosticErrorMessage,
} from "./deployment-admin-infisical-diagnostic";
import {
  readInfisicalEnvironment,
  readInfisicalMachineIdentityProjectAccess,
  readInfisicalProject,
  readInfisicalSecret,
} from "./deployment-secret-infisical-client";
import { deploymentInfisicalSelector } from "./deployment-secret-infisical-selectors";
import { deploymentSecretContractBindings } from "./deployment-sprinkle-ref";

export const DEPLOYMENT_ADMIN_INFISICAL_PLAN_SCHEMA = "deploy-admin-infisical-plan@1";
export const DEPLOYMENT_ADMIN_INFISICAL_CHECK_SCHEMA = "deploy-admin-infisical-check@1";

function deploymentSummary(deployment: DeploymentTarget) {
  return {
    deploymentId: deployment.deploymentId,
    label: deployment.label,
    provider: deployment.provider,
    environmentStage: deployment.environmentStage,
  };
}

function credentialSource(deployment: DeploymentTarget, env: NodeJS.ProcessEnv) {
  const runtime = deployment.infisicalRuntime;
  const envNames = [
    runtime?.machineIdentityClientIdEnv,
    runtime?.machineIdentityClientSecretEnv,
  ].filter((name): name is string => Boolean(name));
  return {
    name: "infisical_machine_identity_universal_auth",
    machineIdentityId: runtime?.machineIdentityId,
    machineIdentityClientIdEnv: runtime?.machineIdentityClientIdEnv,
    machineIdentityClientSecretEnv: runtime?.machineIdentityClientSecretEnv,
    missingEnvVarNames: envNames.filter((name) => !String(env[name] || "").trim()),
  };
}

function desiredSecrets(deployment: DeploymentTarget) {
  const runtime = deployment.infisicalRuntime;
  if (!runtime) return [];
  return deploymentSecretContractBindings(deployment.secretRequirements, "infisical").map(
    (binding) => ({
      contractId: binding.contractId,
      name: binding.name,
      step: binding.step,
      required: binding.required,
      selector: deploymentInfisicalSelector({
        binding,
        runtime,
        mappings: deployment.infisicalSecretMappings,
      }),
      approvedPlaceholder:
        deployment.infisicalSecretMappings?.[binding.contractId]?.approvedPlaceholder === true,
      placeholderReason:
        deployment.infisicalSecretMappings?.[binding.contractId]?.placeholderReason,
    }),
  );
}

export function buildDeploymentAdminInfisicalPlan(
  deployment: DeploymentTarget,
  env: NodeJS.ProcessEnv = process.env,
) {
  return {
    schemaVersion: DEPLOYMENT_ADMIN_INFISICAL_PLAN_SCHEMA,
    deployment: deploymentSummary(deployment),
    readOnly: true,
    providerMutation: false,
    secretValuesRead: false,
    backendKind: deployment.secretBackend || "vault",
    supported: deployment.secretBackend === "infisical",
    runtime: deployment.infisicalRuntime
      ? {
          siteUrl: deployment.infisicalRuntime.siteUrl,
          projectId: deployment.infisicalRuntime.projectId,
          environment: deployment.infisicalRuntime.environment,
          secretPath: deployment.infisicalRuntime.secretPath || "/",
        }
      : undefined,
    credentialSource: credentialSource(deployment, env),
    desiredSecrets: desiredSecrets(deployment),
  };
}

async function machineIdentityAccessDiagnostic(opts: {
  deployment: DeploymentTarget;
  credential: InfisicalCredentialConfig;
  fetchImpl?: typeof fetch;
}) {
  const runtime = opts.deployment.infisicalRuntime!;
  if (!runtime.machineIdentityId) {
    return infisicalAdminDiagnostic("machine_identity_project_access", "unsupported", {
      evidenceUnavailableReason: "infisical_runtime.machine_identity_id is not configured",
    });
  }
  try {
    const access = await readInfisicalMachineIdentityProjectAccess({
      credential: opts.credential,
      projectId: runtime.projectId,
      machineIdentityId: runtime.machineIdentityId,
      fetchImpl: opts.fetchImpl,
    });
    if (!access) {
      return infisicalAdminDiagnostic("machine_identity_project_access", "missing", {
        machineIdentityId: runtime.machineIdentityId,
      });
    }
    if (!access.available) {
      return infisicalAdminDiagnostic("machine_identity_project_access", "unsupported", {
        evidenceUnavailableReason:
          access.evidence || "Infisical API did not expose access evidence",
      });
    }
    return infisicalAdminDiagnostic(
      "machine_identity_project_access",
      access.access ? "ok" : "missing",
      {
        machineIdentityId: runtime.machineIdentityId,
        permissionEvidence: {
          access: access.access,
          permissions: access.permissions || [],
          evidence: access.evidence,
        },
      },
    );
  } catch (error) {
    return infisicalAdminDiagnostic("machine_identity_project_access", "error", {
      message: infisicalAdminDiagnosticErrorMessage(error, opts.credential),
    });
  }
}

async function secretDiagnostic(opts: {
  secret: ReturnType<typeof desiredSecrets>[number];
  credential: InfisicalCredentialConfig;
  fetchImpl?: typeof fetch;
}) {
  const result = await checkInfisicalAdminDiagnostic(
    "secret",
    async () =>
      Boolean(
        await readInfisicalSecret({
          credential: opts.credential,
          selector: opts.secret.selector,
          viewSecretValue: false,
          fetchImpl: opts.fetchImpl,
        }),
      ),
    opts.credential,
  );
  if (result.status === "missing" && opts.secret.approvedPlaceholder) {
    return {
      ...result,
      status: "ok" as const,
      placeholderApproved: true,
      placeholderReason: opts.secret.placeholderReason,
      contractId: opts.secret.contractId,
      selector: opts.secret.selector,
    };
  }
  return { ...result, contractId: opts.secret.contractId, selector: opts.secret.selector };
}

export async function checkDeploymentAdminInfisical(opts: {
  deployment: DeploymentTarget;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}) {
  const env = opts.env || process.env;
  const plan = buildDeploymentAdminInfisicalPlan(opts.deployment, env);
  if (opts.deployment.secretBackend !== "infisical" || !opts.deployment.infisicalRuntime) {
    return {
      ...plan,
      schemaVersion: DEPLOYMENT_ADMIN_INFISICAL_CHECK_SCHEMA,
      inSync: false,
      diagnostics: [
        infisicalAdminDiagnostic("backend", "unsupported", {
          message: "deployment does not select the Infisical secret backend",
        }),
      ],
    };
  }
  if (plan.credentialSource.missingEnvVarNames.length > 0) {
    return {
      ...plan,
      schemaVersion: DEPLOYMENT_ADMIN_INFISICAL_CHECK_SCHEMA,
      inSync: false,
      diagnostics: [infisicalAdminDiagnostic("credential_env", "missing")],
    };
  }
  const credential = await resolveInfisicalCredentialFromRuntime({
    runtime: opts.deployment.infisicalRuntime,
    env,
    fetchImpl: opts.fetchImpl,
  });
  const diagnostics = [
    await checkInfisicalAdminDiagnostic(
      "project",
      async () =>
        Boolean(
          await readInfisicalProject({
            credential,
            projectId: opts.deployment.infisicalRuntime!.projectId,
            fetchImpl: opts.fetchImpl,
          }),
        ),
      credential,
    ),
    await checkInfisicalAdminDiagnostic(
      "environment",
      async () =>
        Boolean(
          await readInfisicalEnvironment({
            credential,
            projectId: opts.deployment.infisicalRuntime!.projectId,
            environment: opts.deployment.infisicalRuntime!.environment,
            fetchImpl: opts.fetchImpl,
          }),
        ),
      credential,
    ),
    await machineIdentityAccessDiagnostic({
      deployment: opts.deployment,
      credential,
      fetchImpl: opts.fetchImpl,
    }),
  ];
  for (const secret of desiredSecrets(opts.deployment)) {
    diagnostics.push(await secretDiagnostic({ secret, credential, fetchImpl: opts.fetchImpl }));
  }
  return {
    ...plan,
    schemaVersion: DEPLOYMENT_ADMIN_INFISICAL_CHECK_SCHEMA,
    inSync: diagnostics.every((entry) => entry.status === "ok"),
    diagnostics,
  };
}
