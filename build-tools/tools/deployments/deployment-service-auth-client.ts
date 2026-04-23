#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import { launchBrowser } from "./deployment-browser-launch.ts";
import {
  createDeploymentAuthLoginViaService,
  waitForDeploymentAuthSessionViaService,
} from "./nixos-shared-host-control-plane-client.ts";
import { resolveDeploymentVaultRuntimePlan } from "./deployment-vault-runtime-plan.ts";
import type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs.ts";

function authBlockingMissing(missing: string[]): string[] {
  return missing.filter(
    (entry) =>
      entry.includes("Vault JWT auth") || entry.includes("lane governance repository metadata"),
  );
}

export function shouldUseServiceOwnedInteractiveAuth(opts: {
  deployment: DeploymentTarget;
  inputs?: DeploymentVaultRuntimeInputs;
  env?: NodeJS.ProcessEnv;
}) {
  if (!opts.deployment.vaultRuntime?.oidcIssuer) return false;
  const plan = resolveDeploymentVaultRuntimePlan({
    deployment: opts.deployment,
    inputs: opts.inputs,
    env: opts.env || process.env,
  });
  if (plan.selectionError || !plan.selection) return false;
  return (
    plan.selection.source === "interactive_pkce" ||
    plan.selection.source === "interactive_print_url"
  );
}

export async function createAndWaitForServiceOwnedAuthSession(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  deployment: DeploymentTarget;
  operationKind: string;
  inputs?: DeploymentVaultRuntimeInputs;
  env?: NodeJS.ProcessEnv;
}) {
  const env = opts.env || process.env;
  const plan = resolveDeploymentVaultRuntimePlan({
    deployment: opts.deployment,
    inputs: opts.inputs,
    env,
  });
  const missing = authBlockingMissing(plan.missing);
  if (missing.length > 0) throw new Error(missing[0]);
  if (plan.selectionError) throw new Error(plan.selectionError);
  if (!plan.selection) throw new Error("deployment credential source selection failed");
  const login = await createDeploymentAuthLoginViaService({
    controlPlaneUrl: opts.controlPlaneUrl,
    token: opts.controlPlaneToken,
    request: {
      deployment: opts.deployment,
      operationKind: opts.operationKind,
      credentialSource: plan.selection.source,
      expiresInMs: opts.inputs?.timeoutMs,
    },
  });
  console.error(`Open this deployment login URL: ${login.loginUrl}`);
  if (plan.selection.browserMode !== "print") {
    try {
      await launchBrowser(login.loginUrl);
    } catch (error) {
      console.error(
        `Automatic browser launch failed: ${String((error as Error)?.message || error)}`,
      );
      console.error("Continue by opening the deployment login URL above manually.");
    }
  }
  const status = await waitForDeploymentAuthSessionViaService({
    controlPlaneUrl: opts.controlPlaneUrl,
    token: opts.controlPlaneToken,
    sessionId: login.sessionId,
    timeoutMs: opts.inputs?.timeoutMs,
  });
  if (status.status !== "authenticated") {
    throw new Error(`deployment auth session failed: ${status.failure || status.status}`);
  }
  return login.sessionId;
}
