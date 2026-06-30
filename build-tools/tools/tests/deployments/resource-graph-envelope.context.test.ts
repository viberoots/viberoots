#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeploymentResourceEnvelopes } from "../../deployments/resource-graph-envelope";
import { createDeploymentResourceInventory } from "../../deployments/resource-graph-inventory";
import {
  rejectedServiceClientSelectionRecord,
  resolvedServiceClientSelectionRecord,
} from "../../deployments/resource-graph-service-client";
import type { DeploymentResourceInventory } from "../../deployments/resource-graph-types";
import { admitControlPlaneRuntimeRecord } from "../../deployments/resource-graph-types";
import {
  cloudflareDeployment,
  cloudflareNodes,
  withEnv,
  withProjectConfig,
  writeJson,
} from "./deployment-contexts.scope.helpers";

test("context and control-plane envelopes preserve token refs without raw secrets", async () => {
  await withProjectConfig(projectConfig(), async () => {
    const inventory = createDeploymentResourceInventory(
      cloudflareNodes([cloudflareDeployment({ deployment_context: "app" })]),
    );
    const result = createDeploymentResourceEnvelopes(inventory);
    assert.deepEqual(result.errors, []);
    assert.equal(envelope(result, "Deployment").source.class, "buck");
    for (const kind of ["DeploymentContext", "ControlPlaneProfile", "ControlPlaneSelection"]) {
      assert.equal(envelope(result, kind).source.class, "deployment_context");
    }
    assert.equal(envelope(result, "WorkspaceGraphState").source.class, "workspace_state");
    const service = envelope(result, "ServiceClientProfile");
    assert.equal(service.spec.controlPlaneUrl, "https://control.example");
    assert.equal(service.spec.controlPlaneTokenRef, "secret://control/prod/token");
    assert.equal(JSON.stringify(service).includes("raw-token"), false);
  });
});

test("local override evidence is redacted and fail-closed before envelope trust", async () => {
  await withProjectConfig(projectConfig(), async () => {
    await writeJson("projects/config/local.json", {
      schemaVersion: "viberoots-project-config@1",
      controlPlanes: { prod: { serviceClient: { controlPlaneTokenRef: "secret://local" } } },
    });
    const allowed = createDeploymentResourceEnvelopes(
      createDeploymentResourceInventory(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "app" })]),
      ),
    );
    assert.deepEqual(allowed.errors, []);
    assert.equal(allowed.inventory.workspace.projectConfig.localPresent, true);
    const override = envelope(allowed, "LocalProjectConfigOverride");
    assert.equal(override.source.class, "workspace_state");
    assert.equal(override.source.label, "local-project-config-override");
    assert.equal(JSON.stringify(override.spec).includes("secret://local"), false);
    assert.equal(JSON.stringify(override.spec).includes("<redacted>"), true);
    assert.equal(
      allowed.inventory.workspace.projectConfig.redactedOverrides.some(
        (entry) => entry.localValue === "<redacted>",
      ),
      true,
    );
    await withEnv("VBR_DISALLOW_LOCAL_OVERRIDES", "1", async () => {
      const rejected = createDeploymentResourceEnvelopes(
        createDeploymentResourceInventory(
          cloudflareNodes([cloudflareDeployment({ deployment_context: "app" })]),
        ),
      );
      assert.match(rejected.errors.join("\n"), /local project config overrides are disabled/);
    });
  });
});

test("service-client selection envelopes preserve token refs and invalid profile diagnostics", () => {
  const inventory = createDeploymentResourceInventory([], {
    runtimeSources: {
      serviceClientSelections: [
        admitControlPlaneRuntimeRecord(
          resolvedServiceClientSelectionRecord({
            id: "remote-prod",
            source: "remote",
            client: {
              controlPlaneUrl: "https://remote.example",
              controlPlaneName: "prod",
              controlPlaneTokenRef: "runtime://github-actions/control-plane-token",
              plan: { controlPlaneTokenEnv: "DEPLOY_TOKEN" },
            } as never,
          }),
        ),
        admitControlPlaneRuntimeRecord(
          rejectedServiceClientSelectionRecord({
            id: "remote-invalid",
            source: "remote",
            error: new Error("controlPlaneTokenRef must be a secret:// or runtime:// ref"),
          }),
        ),
      ],
    },
  });
  const result = createDeploymentResourceEnvelopes(inventory);
  assert.deepEqual(result.errors, []);
  const selected = namedEnvelope(result, "remote-prod");
  assert.equal(selected.source.class, "runtime");
  assert.equal(selected.source.label, "admitted-control-plane-record");
  assert.equal(selected.spec.controlPlaneTokenRef, "runtime://github-actions/control-plane-token");
  assert.equal(JSON.stringify(selected).includes("DEPLOY_TOKEN_VALUE"), false);
  const invalid = namedEnvelope(result, "remote-invalid");
  assert.equal(invalid.spec.status, "rejected");
  assert.match(String(invalid.spec.diagnostic), /controlPlaneTokenRef must be/);
});

test("repo-owned Buck intent uids are stable across named source modes", () => {
  const modes = [
    "/nix/store/source-viberoots",
    ".viberoots/current -> ..",
    ".viberoots/current -> ../viberoots",
  ];
  const uids = modes.map(
    (sourcePath) =>
      createDeploymentResourceEnvelopes(manualInventory(sourcePath)).envelopes[0].metadata.uid,
  );
  assert.deepEqual(new Set(uids).size, 1);
});

function projectConfig() {
  return {
    controlPlanes: {
      prod: {
        serviceClient: {
          controlPlaneUrl: "https://control.example",
          controlPlaneTokenRef: "secret://control/prod/token",
        },
      },
    },
    deploymentContexts: {
      app: { controlPlane: "prod", cloudflare: { account: "web-platform", projectName: "app" } },
    },
  };
}

function envelope(result: ReturnType<typeof createDeploymentResourceEnvelopes>, kind: string) {
  const found = result.envelopes.find((item) => item.kind === kind);
  assert.ok(found, `${kind} envelope missing`);
  return found;
}

function namedEnvelope(result: ReturnType<typeof createDeploymentResourceEnvelopes>, name: string) {
  const found = result.envelopes.find((item) => item.metadata.name === name);
  assert.ok(found, `${name} envelope missing`);
  return found;
}

function manualInventory(sourcePath: string): DeploymentResourceInventory {
  return {
    taxonomyVersion: "deployment-resource-taxonomy@1",
    errors: [],
    graphRead: { providerIndexAvailable: false, nodeLockIndexAvailable: false },
    workspace: {
      supportedDeploymentQueryRoots: [],
      projectConfig: {
        sharedPath: "projects/config/shared.json",
        localPath: "projects/config/local.json",
        localPresent: false,
        disallowLocalOverrides: false,
        redactedOverrides: [],
      },
    },
    resources: [
      {
        kind: "Deployment",
        id: "app-prod",
        authority: "reviewed_intent",
        source: { class: "buck", label: "//projects/deployments/app:deploy", path: sourcePath },
      },
    ],
  };
}
