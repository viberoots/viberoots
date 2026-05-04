#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { deploymentAuthFailureDiagnostic } from "./deployment-auth-failure-diagnostics";
import { deploymentSecretFixturePath } from "./deployment-secret-fixture";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import { resolveCredentialSourceVaultJwt } from "./deployment-credential-source-runtime";
import type { DeploymentCredentialSource } from "./deployment-credential-source-selection";
import type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs";
import { resolveDeploymentVaultRuntimePlan } from "./deployment-vault-runtime-plan";
import { resolveDeploymentPkceCallbackProfile } from "./deployment-pkce-callback-profile";
export type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs";
export { readDeploymentVaultRuntimeInputsFromFlags } from "./deployment-vault-runtime-inputs";
export {
  DEFAULT_DEPLOYMENT_CLI_PUBLIC_CLIENT_ID,
  DEFAULT_DEPLOYMENT_CLIENT_ID,
  DEFAULT_DEPLOYMENT_CLIENT_SECRET_ENV,
  DEFAULT_DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV,
  DEFAULT_VAULT_AUDIENCE,
  DEPLOYMENT_CLI_PUBLIC_CLIENT_ID_ENV,
  DEPLOYMENT_CLIENT_ID_ENV,
  DEPLOYMENT_CLIENT_SECRET_ENV_ENV,
  DEPLOYMENT_CREDENTIAL_SOURCE_ENV,
  DEPLOYMENT_ENVIRONMENT_ENV,
  DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV_ENV,
  VAULT_AUDIENCE_ENV,
  VAULT_OIDC_ISSUER_ENV,
  defaultVaultJwtRoleName,
} from "./deployment-vault-runtime-plan";

export type PreparedDeploymentVaultRuntime = {
  minted: boolean;
  roleName?: string;
  credentialSource?: DeploymentCredentialSource;
  secretContext?: DeploymentSecretContext;
};

export async function cleanupDeploymentVaultRuntime(runtime: PreparedDeploymentVaultRuntime) {
  const credential =
    runtime.secretContext?.kind === "vault" ? runtime.secretContext.credential : undefined;
  if (credential?.kind === "jwt") credential.workloadJwt = "";
  if (credential?.kind === "token") credential.token = "";
  runtime.secretContext = undefined;
}

export async function prepareDeploymentVaultRuntime(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  inputs?: DeploymentVaultRuntimeInputs | undefined;
  env?: NodeJS.ProcessEnv;
}): Promise<PreparedDeploymentVaultRuntime> {
  const env = opts.env || process.env;
  if (opts.deployment.secretRequirements.length === 0) return { minted: false };
  if (deploymentSecretFixturePath()) return { minted: false, secretContext: { kind: "fixture" } };

  const plan = resolveDeploymentVaultRuntimePlan({
    deployment: opts.deployment,
    inputs: opts.inputs,
    env,
  });
  if (plan.missing.length > 0) throw new Error(plan.missing[0]);
  if (plan.selectionError) throw new Error(plan.selectionError);
  if (plan.credentialInputMissing.length > 0) throw new Error(plan.credentialInputMissing[0]);
  if (!plan.selection) throw new Error("deployment credential source selection failed");

  const credential = await resolveCredentialSourceVaultJwt({
    source: plan.selection.source,
    addr: plan.addr,
    roleName: plan.roleName,
    issuerUrl: plan.issuerUrl,
    serviceClientId: plan.serviceClientId,
    humanClientId: plan.humanClientId,
    clientSecretEnv: plan.clientSecretEnv,
    externalOidcTokenEnv: plan.externalOidcTokenEnv,
    audience: plan.audience,
    deploymentEnvironment: plan.deploymentEnvironment,
    repository: plan.repository,
    env,
    openBrowser: plan.selection.source === "interactive_pkce",
    pkceCallback: plan.selection.source.startsWith("interactive")
      ? resolveDeploymentPkceCallbackProfile({
          inputs: opts.inputs?.pkceCallback,
          env,
          metadata: opts.deployment.vaultRuntime?.pkceCallback,
        })
      : undefined,
    timeoutMs: opts.inputs?.timeoutMs,
    prompt: (message) => console.error(message),
  }).catch((error) => {
    const diagnostic = deploymentAuthFailureDiagnostic(error);
    throw new Error(`${diagnostic.category}: ${diagnostic.message}. ${diagnostic.action}`);
  });

  return {
    minted: true,
    roleName: plan.roleName,
    credentialSource: credential.source,
    secretContext: {
      kind: "vault",
      credential: {
        kind: "jwt",
        addr: credential.addr,
        role: credential.roleName,
        workloadJwt: credential.workloadJwt,
      },
    },
  };
}
