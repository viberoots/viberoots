#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentsFromChanges } from "../../deployments/deployment-from-changes-selection.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import {
  nixosSharedHostDeploymentFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture.ts";

async function writeGraph(root: string, nodes: unknown[]) {
  const graphPath = path.join(root, "build-tools", "tools", "buck", "graph.json");
  await fsp.mkdir(path.dirname(graphPath), { recursive: true });
  await fsp.writeFile(graphPath, JSON.stringify({ version: 1, nodes }, null, 2) + "\n", "utf8");
}

async function withTempRoot(fn: (root: string) => Promise<void>) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "deployment-from-changes-"));
  try {
    await fn(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

function pleominoDeployments() {
  const lanePolicy = nixosSharedHostLanePolicyFixture();
  return [
    nixosSharedHostDeploymentFixture({
      deploymentId: "pleomino-dev",
      label: "//projects/deployments/pleomino-dev:deploy",
      component: { kind: "static-webapp", target: "//projects/apps/pleomino:app" },
      runtime: { appName: "pleomino", containerPort: 3000 },
      lanePolicy,
      prerequisites: [],
    }),
    cloudflarePagesDeploymentFixture({
      deploymentId: "pleomino-staging",
      label: "//projects/deployments/pleomino-staging:deploy",
      lanePolicy,
      prerequisites: [{ deploymentId: "pleomino-dev", mode: "ordering_only" }],
    }),
    cloudflarePagesDeploymentFixture({
      deploymentId: "pleomino-prod",
      label: "//projects/deployments/pleomino-prod:deploy",
      environmentStage: "prod",
      providerTarget: {
        account: "web-platform-prod",
        project: "pleomino-prod-pages",
        id: "pleomino-prod-pages",
        canonicalUrl: "https://pleomino-prod-pages.pages.dev/",
        providerTargetIdentity: "cloudflare-pages:web-platform-prod/pleomino-prod-pages",
      },
      lanePolicy,
      admissionPolicyRef: "//projects/deployments/pleomino-shared:prod_release",
      admissionPolicy: {
        ...cloudflarePagesDeploymentFixture().admissionPolicy,
        ref: "//projects/deployments/pleomino-shared:prod_release",
        name: "prod_release",
        allowedRefs: ["env/pleomino/prod"],
      },
      prerequisites: [{ deploymentId: "pleomino-staging", mode: "ordering_only" }],
    }),
  ];
}

test("from-changes selects deployments whose component project is in the impacted Buck closure", async () => {
  await withTempRoot(async (tmp) => {
    await writeGraph(tmp, [
      { name: "//projects/apps/pleomino:app", deps: ["//projects/libs/shared-ui:lib"] },
      { name: "//projects/libs/shared-ui:lib", deps: [] },
    ]);
    const plan = await resolveDeploymentsFromChanges({
      workspaceRoot: tmp,
      changedPaths: ["projects/libs/shared-ui/src/index.ts"],
      deployments: pleominoDeployments(),
    });

    assert.deepEqual(
      plan.selectedDeployments.map((deployment) => deployment.deploymentId),
      ["pleomino-dev", "pleomino-staging", "pleomino-prod"],
    );
    assert.equal(plan.reasonsByDeploymentId["pleomino-dev"]?.[0]?.kind, "component-project");
  });
});

test("from-changes widens only one direct prerequisite edge from changed deployment metadata", async () => {
  await withTempRoot(async (tmp) => {
    await writeGraph(tmp, [{ name: "//projects/apps/pleomino:app", deps: [] }]);
    const plan = await resolveDeploymentsFromChanges({
      workspaceRoot: tmp,
      changedPaths: ["projects/deployments/pleomino-dev/TARGETS"],
      deployments: pleominoDeployments(),
    });

    assert.deepEqual(plan.directDeploymentIds, ["pleomino-dev"]);
    assert.deepEqual(
      plan.selectedDeployments.map((deployment) => deployment.deploymentId),
      ["pleomino-dev", "pleomino-staging"],
    );
    assert.equal(
      plan.reasonsByDeploymentId["pleomino-staging"]?.some(
        (reason) => reason.kind === "prerequisite-widening",
      ),
      true,
    );
  });
});
