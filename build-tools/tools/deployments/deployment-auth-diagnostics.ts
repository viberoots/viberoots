#!/usr/bin/env zx-wrapper
import { getFlagList, getFlagStr, getPositionals } from "../lib/cli";
import { printDeployJson } from "./deploy-front-door";
import { resolveDeploymentForCli } from "./deployment-cli-resolve";
import { readDeploymentVaultRuntimeInputsFromFlags } from "./deployment-vault-runtime-inputs";
import { deploymentAuthMatrix, renderDeploymentJenkinsHelp } from "./deployment-auth-matrix";
import { redactDeploymentAuthJson, redactDeploymentAuthText } from "./deployment-auth-redaction";
import { resolveDeploymentVaultRuntimePlan } from "./deployment-vault-runtime-plan";
import type { DeploymentTarget } from "./contract";
import { resolveDeploymentPkceCallbackProfile } from "./deployment-pkce-callback-profile";
import {
  buildDeploymentAuthActionSummary,
  buildDeploymentAuthGroupSummary,
  buildDeploymentAuthKeycloakRealm,
} from "./deployment-auth-readonly";
import {
  buildDeploymentInfisicalIdentityExplanation,
  buildDeploymentSecretBackendExplanation,
} from "./deployment-auth-infisical-diagnostics";
import { resolveAllDeployments } from "./deployment-query";

export const DEPLOYMENT_AUTH_DOCTOR_SCHEMA = "deployment-auth-doctor@1";
export const DEPLOYMENT_AUTH_EXPLAIN_VAULT_ROLE_SCHEMA = "deployment-auth-vault-role@1";
export const DEPLOYMENT_AUTH_LOGIN_SCHEMA = "deployment-auth-login@1";

export const DEPLOYMENT_AUTH_SESSION_POLICY = {
  persistentCache: false,
  statusCommandAvailable: false,
  logoutCommandAvailable: false,
  scope: ["issuer", "client_id", "repository", "deployment_environment", "credential_source"],
  storage: "memory-only; no repo files, .local files, shell history, or plain env files",
} as const;

function requireFlag(name: string): string {
  const next = getFlagStr(name, "").trim();
  if (next) return next;
  throw new Error(`missing required --${name}`);
}

function commandName(): string {
  const [, command = ""] = getPositionals();
  return command;
}

function automationPrincipalIds(): string[] {
  return getFlagList("automation-principal");
}

function selectionStatus(plan: ReturnType<typeof resolveDeploymentVaultRuntimePlan>) {
  if (plan.selection) {
    return {
      source: plan.selection.source,
      reason: plan.selection.reason,
      browserMode: plan.selection.browserMode,
    };
  }
  return { error: plan.selectionError || "credential source was not selected" };
}

function deploymentSummary(deployment: DeploymentTarget) {
  return {
    deploymentId: deployment.deploymentId,
    label: deployment.label,
    provider: deployment.provider,
    environmentStage: deployment.environmentStage,
    protectionClass: deployment.protectionClass,
  };
}

export function buildDeploymentAuthDoctor(deployment: DeploymentTarget, env = process.env) {
  const inputs = readDeploymentVaultRuntimeInputsFromFlags();
  const plan = resolveDeploymentVaultRuntimePlan({
    deployment,
    inputs,
    env,
  });
  const callbackProfile = resolveDeploymentPkceCallbackProfile({
    inputs: inputs.pkceCallback,
    env,
    metadata: deployment.vaultRuntime?.pkceCallback,
  });
  return redactDeploymentAuthJson({
    schemaVersion: DEPLOYMENT_AUTH_DOCTOR_SCHEMA,
    deployment: deploymentSummary(deployment),
    readOnly: true,
    providerMutation: false,
    tokensMinted: false,
    secretValuesRead: false,
    sessionPolicy: DEPLOYMENT_AUTH_SESSION_POLICY,
    credentialSource: selectionStatus(plan),
    vaultRuntime: {
      required: plan.requiresSecrets,
      fixtureActive: plan.fixtureActive,
      missing: plan.missing,
      credentialInputMissing: plan.credentialInputMissing,
      addr: plan.addr,
      issuer: plan.issuerUrl,
      audience: plan.audience,
      roleName: plan.roleName,
      deploymentEnvironment: plan.deploymentEnvironment,
      repository: plan.repository,
      boundClaimKeys: ["deployment_environment", "repository"],
      pkceCallback: callbackProfile,
    },
  });
}

export function buildDeploymentVaultRoleExplanation(
  deployment: DeploymentTarget,
  env = process.env,
) {
  const plan = resolveDeploymentVaultRuntimePlan({
    deployment,
    inputs: readDeploymentVaultRuntimeInputsFromFlags(),
    env,
  });
  return redactDeploymentAuthJson({
    schemaVersion: DEPLOYMENT_AUTH_EXPLAIN_VAULT_ROLE_SCHEMA,
    deployment: deploymentSummary(deployment),
    readOnly: true,
    tokensMinted: false,
    vault: {
      addr: plan.addr,
      expectedIssuer: plan.issuerUrl,
      expectedAudience: plan.audience,
      roleName: plan.roleName,
      policyName: `${plan.roleName}-policy`,
      boundClaims: {
        deployment_environment: plan.deploymentEnvironment,
        repository: plan.repository,
      },
      boundClaimKeys: ["deployment_environment", "repository"],
      missing: plan.missing,
    },
  });
}

export function buildDeploymentAuthLoginInstructions(
  deployment: DeploymentTarget,
  env = process.env,
) {
  const inputs = readDeploymentVaultRuntimeInputsFromFlags();
  const plan = resolveDeploymentVaultRuntimePlan({
    deployment,
    inputs,
    env,
  });
  const callbackProfile = resolveDeploymentPkceCallbackProfile({
    inputs: inputs.pkceCallback,
    env,
    metadata: deployment.vaultRuntime?.pkceCallback,
  });
  return redactDeploymentAuthJson({
    schemaVersion: DEPLOYMENT_AUTH_LOGIN_SCHEMA,
    deployment: deploymentSummary(deployment),
    readOnly: true,
    browserLaunched: false,
    tokensMinted: false,
    sessionPolicy: DEPLOYMENT_AUTH_SESSION_POLICY,
    credentialSource: selectionStatus(plan),
    instructions: [
      "Use --login-browser=print to print a PKCE URL without launching a browser.",
      "Use reviewed vault_runtime PKCE callback metadata for shared deploy hosts.",
      "Use --pkce-callback-* flags only for emergency/operator callback overrides.",
      "Use --login-browser=device when the issuer supports device authorization.",
      "The resulting workload JWT is kept in memory for the deploy process only.",
    ],
    issuer: plan.issuerUrl,
    audience: plan.audience,
    clientId: plan.humanClientId,
    pkceCallback: callbackProfile,
    boundClaimKeys: ["deployment_environment", "repository"],
  });
}

async function authDeployment(workspaceRoot: string) {
  return await resolveDeploymentForCli(workspaceRoot, requireFlag, {
    deploymentJsonErrorMessage:
      "public repo-level deploy auth requires --deployment <label>; --deployment-json is not an operator source of truth",
  });
}

export async function maybeHandleDeploymentAuthCli(workspaceRoot: string): Promise<boolean> {
  const [group] = getPositionals();
  if (group !== "auth") return false;
  const command = commandName();
  if (command === "print-keycloak-realm") {
    printDeployJson(
      buildDeploymentAuthKeycloakRealm(
        await resolveAllDeployments(workspaceRoot),
        automationPrincipalIds(),
      ),
    );
    return true;
  }
  const deployment = await authDeployment(workspaceRoot);
  if (command === "doctor") {
    printDeployJson(buildDeploymentAuthDoctor(deployment));
    return true;
  }
  if (command === "print-groups") {
    printDeployJson(buildDeploymentAuthGroupSummary(deployment, automationPrincipalIds()));
    return true;
  }
  if (command === "explain-groups") {
    const action = getFlagStr("action", "").trim() as "submit" | "approve" | "report_checks";
    if (!["submit", "approve", "report_checks"].includes(action)) {
      throw new Error("--action must be one of submit, approve, report_checks");
    }
    printDeployJson(buildDeploymentAuthActionSummary(deployment, action, automationPrincipalIds()));
    return true;
  }
  if (command === "explain-vault-role") {
    printDeployJson(buildDeploymentVaultRoleExplanation(deployment));
    return true;
  }
  if (command === "explain-secret-backend") {
    printDeployJson(buildDeploymentSecretBackendExplanation(deployment));
    return true;
  }
  if (command === "explain-infisical-identity") {
    printDeployJson(buildDeploymentInfisicalIdentityExplanation(deployment));
    return true;
  }
  if (command === "print-login") {
    printDeployJson(buildDeploymentAuthLoginInstructions(deployment));
    return true;
  }
  const plan = resolveDeploymentVaultRuntimePlan({
    deployment,
    inputs: readDeploymentVaultRuntimeInputsFromFlags(),
  });
  if (command === "print-jenkins-help") {
    console.log(redactDeploymentAuthText(renderDeploymentJenkinsHelp(plan)));
    return true;
  }
  if (command === "credential-source-matrix") {
    printDeployJson(deploymentAuthMatrix(plan));
    return true;
  }
  throw new Error(
    "deploy auth command must be one of doctor, print-groups, explain-groups, print-keycloak-realm, explain-vault-role, explain-secret-backend, explain-infisical-identity, print-login, print-jenkins-help, credential-source-matrix",
  );
}
