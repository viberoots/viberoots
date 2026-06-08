#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import {
  extractDeployments,
  type CloudflareContainersDeployment,
  type DeploymentTarget,
} from "../../deployments/contract";
import type { DeployCliReadonlyFlags } from "../../deployments/deploy-cli-readonly";
import type { GraphNode } from "../../lib/graph";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture";

export const TOKEN_REF = "runtime://github-actions/control-plane-token";
export const SELECTED_URL = "https://control.prod.example";

export function withControlPlane<T extends DeploymentTarget>(deployment: T): T {
  return {
    ...deployment,
    controlPlane: {
      name: "prod",
      serviceClient: {
        controlPlaneUrl: SELECTED_URL,
        controlPlaneTokenRef: TOKEN_REF,
      },
      records: { backend: "service" as const },
    },
  };
}

export function flags(overrides: Partial<DeployCliReadonlyFlags> = {}): DeployCliReadonlyFlags {
  return {
    printTargetIdentity: false,
    printVaultBootstrap: false,
    printVaultSecretTemplates: false,
    vaultBootstrapFormat: "json",
    vaultSecretTemplateFormat: "json",
    vaultBootstrapInputs: {},
    vaultRuntimeInputs: {},
    validateOnly: false,
    remove: false,
    provisionOnly: false,
    publishOnly: false,
    preview: false,
    previewCleanup: false,
    rollback: false,
    retireTarget: false,
    migrateTarget: false,
    targetExceptionRef: "",
    cleanupReason: "manual_cleanup",
    sourceRunId: "",
    artifactDirFlag: "",
    controlPlaneDatabaseUrl: "",
    controlPlaneUrl: "",
    remote: "",
    allowControlPlaneOverride: false,
    ...overrides,
  };
}

export function cloudflareContainersDeployment(): CloudflareContainersDeployment {
  const { deployments, errors } = extractDeployments([
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    serviceNode(),
    deploymentNode(),
  ]);
  assert.deepEqual(errors, []);
  return deployments[0] as CloudflareContainersDeployment;
}

function serviceNode(): GraphNode {
  return { name: "//projects/apps/api:service_artifact", labels: ["kind:app", "kind:service"] };
}

function deploymentNode(): GraphNode {
  return {
    name: "//projects/deployments/api-staging:deploy",
    provider: "cloudflare-containers",
    component: "//projects/apps/api:service_artifact",
    component_kind: "service",
    publisher: "cloudflare-containers-local",
    publisher_config: "wrangler.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino/shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/pleomino/shared:staging_release",
    provider_target: {
      account_id: "0123456789abcdef0123456789abcdef",
      worker: "api-staging",
      ingress_mode: "public",
      domain: "api.example.com",
      cloudflare_zone_id: "0123456789abcdef0123456789abcdef",
      container_port: "8080",
      health_path: "/healthz",
    },
  };
}

export function runtimeHostConfig() {
  return {
    runtimeHosts: {
      "github-actions": {
        bindings: {
          "control-plane-token": {
            kind: "env",
            name: "DEPLOY_CONTROL_PLANE_TOKEN",
          },
        },
      },
    },
  };
}

export async function withFetchCapture(run: () => Promise<void>) {
  const oldFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization?: string; body: any }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: input instanceof URL ? input.toString() : String(input),
      authorization: String((init?.headers as any)?.authorization || ""),
      body: JSON.parse(String(init?.body || "{}")),
    });
    return {
      ok: true,
      status: 200,
      async json() {
        const body = calls[calls.length - 1]?.body;
        return {
          submissionId: body.submissionId,
          deploymentId: body.deployment.deploymentId,
          lifecycleState: "finished",
          finalOutcome: "succeeded",
        };
      },
      async text() {
        return "";
      },
    } as Response;
  }) as typeof fetch;
  try {
    await run();
    return calls;
  } finally {
    globalThis.fetch = oldFetch;
  }
}
