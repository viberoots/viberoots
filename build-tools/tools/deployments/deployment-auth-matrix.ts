#!/usr/bin/env zx-wrapper
import type { DeploymentVaultRuntimePlan } from "./deployment-vault-runtime-plan";

export const DEPLOYMENT_AUTH_MATRIX_SCHEMA = "deployment-auth-matrix@1";

export type DeploymentAuthMatrixRow = {
  source: string;
  environment: string;
  credentialMaterial: string;
  operatorAction: string;
};

export function deploymentAuthMatrixRows(
  plan: DeploymentVaultRuntimePlan,
): DeploymentAuthMatrixRow[] {
  return [
    {
      source: "interactive_pkce",
      environment: "local desktop",
      credentialMaterial: "browser login, memory-only workload JWT",
      operatorAction: `use client ${plan.humanClientId} and issuer ${plan.issuerUrl || "<issuer>"}`,
    },
    {
      source: "interactive_print_url",
      environment: "SSH or headless shell",
      credentialMaterial: "printed PKCE URL, memory-only workload JWT",
      operatorAction: "forward the callback URL or copy the printed login URL to a browser",
    },
    {
      source: "interactive_device",
      environment: "SSH or browserless shell with device flow",
      credentialMaterial: "device/user code, memory-only workload JWT",
      operatorAction: "open the verification URI on another device and enter the user code",
    },
    {
      source: "jenkins_client_secret",
      environment: "Jenkins Secret Text credential",
      credentialMaterial: `secret from ${plan.clientSecretEnv}, memory-only workload JWT`,
      operatorAction: "bind the secret inside withCredentials before invoking deploy",
    },
    {
      source: "jenkins_oidc",
      environment: "Jenkins OIDC token credential",
      credentialMaterial: `OIDC token from ${plan.externalOidcTokenEnv}`,
      operatorAction: "bind or mint the OIDC token inside the deploy stage only",
    },
    {
      source: "external_oidc_token",
      environment: "reviewed external CI OIDC",
      credentialMaterial: `OIDC token from ${plan.externalOidcTokenEnv}`,
      operatorAction: "provide a token whose issuer, audience, and bound claims match Vault",
    },
  ];
}

export function deploymentAuthMatrix(plan: DeploymentVaultRuntimePlan) {
  return {
    schemaVersion: DEPLOYMENT_AUTH_MATRIX_SCHEMA,
    rows: deploymentAuthMatrixRows(plan),
  };
}

export function renderDeploymentJenkinsHelp(plan: DeploymentVaultRuntimePlan): string {
  return [
    "Deployment Jenkins Auth Help",
    `deployment_environment=${plan.deploymentEnvironment}`,
    `vault_addr=${plan.addr || "<vault addr>"}`,
    `vault_role=${plan.roleName}`,
    `issuer=${plan.issuerUrl || "<issuer>"}`,
    `audience=${plan.audience}`,
    `client_id=${plan.serviceClientId}`,
    `client_secret_env=${plan.clientSecretEnv}`,
    `oidc_token_env=${plan.externalOidcTokenEnv}`,
    "withCredentials([string(credentialsId: 'deployment-client-secret', variable: '" +
      `${plan.clientSecretEnv}')]) {`,
    "  sh 'deploy auth doctor --deployment <label> --credential-source jenkins_client_secret'",
    "  sh 'deploy --deployment <label> --credential-source jenkins_client_secret'",
    "}",
    "Keep the bound credential inside the withCredentials block and never echo its value.",
  ].join("\n");
}
