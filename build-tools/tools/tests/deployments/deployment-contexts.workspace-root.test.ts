#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import {
  DEFAULT_GRAPH_PATH,
  DEFAULT_NODE_LOCK_INDEX_PATH,
  DEFAULT_PROVIDER_INDEX_JSON_PATH,
} from "../../lib/workspace-state-paths";
import {
  extractCloudflarePagesDeployments,
  extractKubernetesDeployments,
} from "../../deployments/contract";
import { deploymentGraphReadOptions } from "../../deployments/deployment-graph-read-options";
import { resolveServiceClientFromFlags } from "../../deployments/nixos-shared-host-service-client-config";
import { cloudflareDeployment, cloudflareNodes } from "./deployment-contexts.scope.helpers";
import {
  kubernetesAdmissionPolicyNodeFixture,
  kubernetesLanePolicyNodeFixture,
} from "./kubernetes.fixture";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture";

const TOKEN_REF = "runtime://github-actions/control-plane-token";

test("context extraction reads project config from workspace root from nested cwd", async () => {
  await withWorkspace(async ({ root, nested }) => {
    await writeProjectConfig(root, {
      controlPlanes: controlPlanes("https://root-control.example"),
      deploymentContexts: {
        "app-prod": context("mini", "root-account", "root-project"),
      },
    });
    await writeProjectConfig(nested, {
      controlPlanes: controlPlanes("https://nested-control.example"),
      deploymentContexts: {
        "app-prod": context("mini", "nested-account", "nested-project"),
      },
    });
    const { deployments, errors } = extractCloudflarePagesDeployments(
      cloudflareNodes([cloudflareDeployment({ deployment_context: "app-prod" })]),
      { workspaceRoot: root },
    );
    assert.deepEqual(errors, []);
    assert.equal(deployments[0]?.providerTarget.account, "root-account");
    assert.equal(
      deployments[0]?.deploymentContext?.controlPlane?.serviceClient.controlPlaneUrl,
      "https://root-control.example",
    );
  });
});

test("protected shared context validation fails closed from nested cwd", async () => {
  await withWorkspace(async ({ root, nested }) => {
    await writeProjectConfig(root, {
      deploymentContexts: {
        "app-prod": { cloudflare: { account: "root-account", projectName: "root-project" } },
      },
    });
    await writeProjectConfig(nested, {
      controlPlanes: controlPlanes("https://nested-control.example"),
      deploymentContexts: {
        "app-prod": context("mini", "nested-account", "nested-project"),
      },
    });
    const errors = extractCloudflarePagesDeployments(
      cloudflareNodes([cloudflareDeployment({ deployment_context: "app-prod" })]),
      { workspaceRoot: root },
    ).errors;
    assert.ok(errors.some((entry) => entry.includes("must select a valid controlPlane")));
  });
});

test("local-only extraction accepts absent workspace project config", async () => {
  await withWorkspace(async ({ root }) => {
    const { deployments, errors } = extractKubernetesDeployments(kubernetesLocalOnlyNodes(), {
      workspaceRoot: root,
    });
    assert.deepEqual(errors, []);
    assert.equal(deployments[0]?.providerTarget.providerTargetIdentity, "kubernetes:dev/web/api");
  });
});

test("remote profile lookup keeps explicit workspace-root behavior", async () => {
  await withWorkspace(async ({ root, nested }) => {
    await writeProjectConfig(root, {
      controlPlanes: controlPlanes("https://root-control.example"),
      runtimeHosts: runtimeHosts(),
    });
    await writeProjectConfig(nested, {
      controlPlanes: controlPlanes("https://nested-control.example"),
    });
    const client = await resolveServiceClientFromFlags({
      workspaceRoot: root,
      remote: "mini",
      context: "nested remote lookup",
      env: { DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token" },
    });
    assert.equal(client.controlPlaneUrl, "https://root-control.example");
    assert.equal(client.controlPlaneTokenRef, TOKEN_REF);
  });
});

test("read-only graph options resolve default inputs from workspace root", async () => {
  await withWorkspace(async ({ root }) => {
    assert.deepEqual(deploymentGraphReadOptions(root), {
      graphPath: path.join(root, DEFAULT_GRAPH_PATH),
      providerIndexPath: path.join(root, DEFAULT_PROVIDER_INDEX_JSON_PATH),
      nodeLockIndexPath: path.join(root, DEFAULT_NODE_LOCK_INDEX_PATH),
    });
    assert.equal(
      deploymentGraphReadOptions(root, "custom/graph.json").graphPath,
      path.join(root, "custom", "graph.json"),
    );
  });
});

async function withWorkspace(run: (paths: { root: string; nested: string }) => Promise<void>) {
  const oldCwd = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deployment-context-root-"));
  const nested = path.join(root, "projects", "deployments", "pleomino", "nested");
  try {
    await fs.mkdir(nested, { recursive: true });
    process.chdir(nested);
    await run({ root, nested });
  } finally {
    process.chdir(oldCwd);
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeProjectConfig(root: string, shared: Record<string, unknown>) {
  await writeJson(path.join(root, "projects", "config", "shared.json"), {
    schemaVersion: "viberoots-project-config@1",
    ...shared,
  });
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function controlPlanes(controlPlaneUrl: string) {
  return {
    mini: {
      serviceClient: {
        controlPlaneUrl,
        controlPlaneTokenRef: TOKEN_REF,
      },
      records: { backend: "service" },
    },
  };
}

function context(controlPlane: string, account: string, projectName: string) {
  return { controlPlane, cloudflare: { account, projectName } };
}

function kubernetesLocalOnlyNodes(): GraphNode[] {
  return [
    { name: "//projects/apps/api:image", labels: ["kind:app"] },
    kubernetesLanePolicyNodeFixture(),
    nixosSharedHostLaneGovernanceNodeFixture({
      source_ref_policies: [
        { stage: "dev", allowed_refs: "main", required_checks: "deploy/pleomino-dev" },
        {
          stage: "staging",
          allowed_refs: "main,refs/tags/release/*",
          required_checks: "deploy/pleomino-staging",
        },
        {
          stage: "prod",
          allowed_refs: "refs/tags/release/*",
          required_checks: "deploy/shared-observability-prod",
        },
      ],
    }),
    kubernetesAdmissionPolicyNodeFixture(),
    {
      name: "//projects/deployments/api-dev:deploy",
      provider: "kubernetes",
      component: "//projects/apps/api:image",
      component_kind: "service",
      publisher: "helm-release",
      publisher_config: "helm/values.yaml",
      protection_class: "local_only",
      lane_policy: "//projects/deployments/pleomino/shared:lane",
      environment_stage: "prod",
      admission_policy: "//projects/deployments/pleomino/shared:prod_release",
      secret_requirements: [],
      runtime_config_requirements: [],
      provider_target: {
        cluster: "dev",
        namespace: "web",
        release: "api",
        service_kind: "worker",
        ingress_mode: "private",
      },
    },
  ];
}

function runtimeHosts() {
  return {
    "github-actions": {
      bindings: {
        "control-plane-token": { kind: "env", name: "DEPLOY_CONTROL_PLANE_TOKEN" },
      },
    },
  };
}
