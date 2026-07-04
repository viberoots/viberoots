#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentsFromChanges } from "../../deployments/deployment-from-changes-selection";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import {
  nixosSharedHostDeploymentFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";

async function writeGraph(root: string, nodes: unknown[]) {
  const text = JSON.stringify({ version: 1, nodes }, null, 2) + "\n";
  for (const rel of [
    path.join(".viberoots", "workspace", "buck", "graph.json"),
    path.join(".viberoots", "workspace", "buck", "graph.json"),
  ]) {
    const graphPath = path.join(root, rel);
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(graphPath, text, "utf8");
  }
}

async function withTempRoot(fn: (root: string) => Promise<void>) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "deployment-from-changes-"));
  try {
    await fn(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

function sampleWebappDeployments() {
  const lanePolicy = nixosSharedHostLanePolicyFixture();
  return [
    nixosSharedHostDeploymentFixture({
      deploymentId: "sample-webapp-dev",
      label: "//projects/deployments/sample-webapp/dev:deploy",
      component: { kind: "static-webapp", target: "//projects/apps/sample-webapp:app" },
      runtime: { appName: "sample-webapp", containerPort: 3000 },
      lanePolicy,
      prerequisites: [],
    }),
    cloudflarePagesDeploymentFixture({
      deploymentId: "sample-webapp-staging",
      label: "//projects/deployments/sample-webapp/staging:deploy",
      lanePolicy,
      prerequisites: [{ deploymentId: "sample-webapp-dev", mode: "ordering_only" }],
    }),
    cloudflarePagesDeploymentFixture({
      deploymentId: "sample-webapp-prod",
      label: "//projects/deployments/sample-webapp/prod:deploy",
      environmentStage: "prod",
      providerTarget: {
        account: "web-platform-prod",
        project: "sample-webapp-prod-pages",
        id: "sample-webapp-prod-pages",
        canonicalUrl: "https://sample-webapp-prod-pages.pages.dev/",
        providerTargetIdentity: "cloudflare-pages:web-platform-prod/sample-webapp-prod-pages",
      },
      lanePolicy,
      admissionPolicyRef: "//projects/deployments/sample-webapp/shared:prod_release",
      admissionPolicy: {
        ...cloudflarePagesDeploymentFixture().admissionPolicy,
        ref: "//projects/deployments/sample-webapp/shared:prod_release",
        name: "prod_release",
        allowedRefs: ["refs/tags/release/*"],
      },
      prerequisites: [{ deploymentId: "sample-webapp-staging", mode: "ordering_only" }],
    }),
  ];
}

function sandboxDeployments() {
  const lanePolicy = nixosSharedHostLanePolicyFixture({
    ref: "//sandbox/deployments/shared:lane",
    governanceRef: "//sandbox/deployments/shared:lane_governance",
    governance: {
      ...nixosSharedHostLanePolicyFixture().governance,
      ref: "//sandbox/deployments/shared:lane_governance",
    },
  });
  return [
    nixosSharedHostDeploymentFixture({
      deploymentId: "sandbox-dev",
      label: "//sandbox/deployments/demo-dev:deploy",
      lanePolicyRef: lanePolicy.ref,
      lanePolicy,
      admissionPolicyRef: "//sandbox/deployments/shared:dev_release",
      admissionPolicy: {
        ...nixosSharedHostDeploymentFixture().admissionPolicy,
        ref: "//sandbox/deployments/shared:dev_release",
      },
      component: { kind: "static-webapp", target: "//sandbox/apps/demo:app" },
      runtime: { appName: "demo", containerPort: 3000 },
      prerequisites: [],
    }),
  ];
}

test("from-changes selects deployments whose component project is in the impacted Buck closure", async () => {
  await withTempRoot(async (tmp) => {
    await writeGraph(tmp, [
      { name: "//projects/apps/sample-webapp:app", deps: ["//projects/libs/shared-ui:lib"] },
      { name: "//projects/libs/shared-ui:lib", deps: [] },
    ]);
    const plan = await resolveDeploymentsFromChanges({
      workspaceRoot: tmp,
      changedPaths: ["projects/libs/shared-ui/src/index.ts"],
      deployments: sampleWebappDeployments(),
    });

    assert.deepEqual(
      plan.selectedDeployments.map((deployment) => deployment.deploymentId),
      ["sample-webapp-dev", "sample-webapp-staging", "sample-webapp-prod"],
    );
    assert.equal(plan.reasonsByDeploymentId["sample-webapp-dev"]?.[0]?.kind, "component-project");
  });
});

test("from-changes widens only one direct prerequisite edge from changed deployment metadata", async () => {
  await withTempRoot(async (tmp) => {
    await writeGraph(tmp, [{ name: "//projects/apps/sample-webapp:app", deps: [] }]);
    const plan = await resolveDeploymentsFromChanges({
      workspaceRoot: tmp,
      changedPaths: ["projects/deployments/sample-webapp/dev/TARGETS"],
      deployments: sampleWebappDeployments(),
    });

    assert.deepEqual(plan.directDeploymentIds, ["sample-webapp-dev"]);
    assert.deepEqual(
      plan.selectedDeployments.map((deployment) => deployment.deploymentId),
      ["sample-webapp-dev", "sample-webapp-staging"],
    );
    assert.equal(
      plan.reasonsByDeploymentId["sample-webapp-staging"]?.some(
        (reason) => reason.kind === "prerequisite-widening",
      ),
      true,
    );
  });
});

test("from-changes derives owned component and deployment prefixes from the deployment set", async () => {
  await withTempRoot(async (tmp) => {
    await writeGraph(tmp, [
      { name: "//sandbox/apps/demo:app", deps: ["//sandbox/libs/ui:lib"] },
      { name: "//sandbox/libs/ui:lib", deps: [] },
    ]);
    const plan = await resolveDeploymentsFromChanges({
      workspaceRoot: tmp,
      changedPaths: ["sandbox/libs/ui/src/index.ts"],
      deployments: sandboxDeployments(),
    });

    assert.deepEqual(
      plan.selectedDeployments.map((deployment) => deployment.deploymentId),
      ["sandbox-dev"],
    );
    assert.equal(plan.reasonsByDeploymentId["sandbox-dev"]?.[0]?.kind, "component-project");
  });
});
