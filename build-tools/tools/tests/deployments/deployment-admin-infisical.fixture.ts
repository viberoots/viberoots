#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import type { DeploymentTarget } from "../../deployments/contract";
import { infisicalRequirement, infisicalRuntime } from "./deployment-secret-infisical.fixture";

export const INFISICAL_ADMIN_DEPLOYMENT = "//projects/deployments/sample-webapp/staging:deploy";

export async function infisicalAdminDeployment(
  siteUrl = "http://127.0.0.1",
): Promise<DeploymentTarget> {
  return {
    deploymentId: "sample-webapp-staging",
    label: INFISICAL_ADMIN_DEPLOYMENT,
    name: "deploy",
    provider: "cloudflare-pages",
    publisher: { type: "wrangler-pages", config: "wrangler.jsonc" },
    providerTarget: {
      id: "sample-webapp-staging",
      account: "sample-platform-staging",
      project: "sample-webapp-staging-pages",
    },
    protectionClass: "shared_nonprod",
    lanePolicyRef: "//projects/deployments/sample-webapp/shared:lane",
    lanePolicy: { stages: [], sourceRefPolicy: {}, allowedPromotionEdges: [] },
    environmentStage: "staging",
    admissionPolicyRef: "//projects/deployments/sample-webapp/shared:staging_release",
    admissionPolicy: { allowedRefs: ["main"], requiredChecks: [], requiredApprovals: [] },
    prerequisites: [],
    secretBackend: "infisical" as const,
    secretBackendProfile: "infisical-default",
    infisicalRuntime: {
      ...infisicalRuntime,
      siteUrl,
      preferredCredentialSource: "machine_identity_universal_auth" as const,
      machineIdentityClientIdEnv: "INFISICAL_CLIENT_ID",
      machineIdentityClientSecretEnv: "INFISICAL_CLIENT_SECRET",
      machineIdentityId: "identity_123",
    },
    secretRequirements: [infisicalRequirement],
    runtimeConfigRequirements: [],
    releaseActions: [],
    targetExceptions: [],
    component: { kind: "static-webapp", target: "//projects/apps/sample-webapp:app" },
    components: [],
  } as DeploymentTarget;
}

export function infisicalAdminEnv() {
  return {
    INFISICAL_CLIENT_ID: "id",
    INFISICAL_CLIENT_SECRET: "client-secret-leak-sentinel",
  };
}

export async function captureDeployCli(run: () => Promise<boolean>) {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (value?: unknown) => {
    lines.push(String(value ?? ""));
  };
  try {
    assert.equal(await run(), true);
    return JSON.parse(lines.join("\n")) as Record<string, unknown>;
  } finally {
    console.log = originalLog;
  }
}

export async function withDeployArgv(args: string[], run: () => Promise<Record<string, unknown>>) {
  const originalArgv = process.argv;
  const originalGlobalArgv = (globalThis as { argv?: unknown }).argv;
  const parsed = {
    _: args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--")),
    deployment: INFISICAL_ADMIN_DEPLOYMENT,
  };
  try {
    process.argv = ["node", "deploy", ...args];
    (globalThis as { argv?: unknown }).argv = parsed;
    return await run();
  } finally {
    process.argv = originalArgv;
    (globalThis as { argv?: unknown }).argv = originalGlobalArgv;
    process.exitCode = undefined;
  }
}
