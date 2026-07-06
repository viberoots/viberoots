#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeploymentResourceEnvelopes } from "../../deployments/resource-graph-envelope";
import { createDeploymentResourceInventory } from "../../deployments/resource-graph-inventory";
import type { DeploymentResourceInventory } from "../../deployments/resource-graph-types";

test("runtime envelopes must derive from admitted runtime records", () => {
  const plainSources = createDeploymentResourceInventory([], {
    runtimeSources: {
      deployRuns: [
        { id: "plain-run", facts: { runId: "plain-run", deploymentId: "app", status: "passed" } },
      ],
    },
  });
  assert.match(plainSources.errors.join("\n"), /not an admitted control-plane record/);
  assert.equal(
    plainSources.resources.some((resource) => resource.kind === "DeployRun"),
    false,
  );

  const result = createDeploymentResourceEnvelopes({
    ...emptyInventory(),
    resources: [
      {
        kind: "DeployRun",
        id: "user-authored-run",
        authority: "observed_runtime",
        source: { class: "runtime" },
        facts: { runId: "user-authored-run", deploymentId: "app", status: "passed" },
      },
    ],
  });
  assert.match(result.errors.join("\n"), /must derive from admitted runtime records/);
});

function emptyInventory(): DeploymentResourceInventory {
  return {
    taxonomyVersion: "deployment-resource-taxonomy@1",
    resources: [],
    errors: [],
    graphRead: { providerIndexAvailable: false, nodeLockIndexAvailable: false },
    workspace: {
      supportedDeploymentQueryRoots: [],
      projectConfig: {
        sharedPath: "",
        localPath: "",
        localPresent: false,
        disallowLocalOverrides: false,
        redactedOverrides: [],
      },
    },
  };
}
