#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeploymentResourceInventory } from "../../deployments/resource-graph-inventory";

test("runtime inventory validates staged-upload cleanup janitor records", () => {
  const valid = createDeploymentResourceInventory([], {
    runtimeSources: { artifactCleanupJanitorRecords: [status("janitor-1", janitorFacts())] },
  });
  assert.deepEqual(valid.errors, []);
  const janitor = valid.resources.find((resource) => resource.id === "janitor-1");
  assert.equal(janitor?.kind, "CleanupEvidence");
  assert.equal(janitor?.facts?.reason, "rejected-submission-cleanup");
  assert.equal(
    (janitor?.facts?.documentJson as any)?.schemaVersion,
    "nixos-shared-host-staged-artifact-janitor@1",
  );

  const inventory = createDeploymentResourceInventory([], {
    runtimeSources: {
      artifactCleanupJanitorRecords: [
        status("janitor-1", {
          ...janitorFacts(),
          documentJson: { schemaVersion: "nixos-shared-host-staged-artifact-janitor@1" },
        }),
      ],
    },
  });
  const errors = inventory.errors.join("\n");
  assert.match(errors, /janitor document reason is required/);
  assert.match(errors, /janitor document stagedReference is required/);
  assert.match(errors, /janitor document cleanupError is required/);
});

function status(id: string, facts: Record<string, unknown>) {
  return { id, facts };
}

function janitorFacts() {
  return {
    recordId: "janitor-1",
    submissionId: "submission-1",
    deploymentId: "pleomino",
    reason: "rejected-submission-cleanup",
    createdAt: "2026-01-01T00:00:00.000Z",
    documentJson: {
      schemaVersion: "nixos-shared-host-staged-artifact-janitor@1",
      reason: "rejected-submission-cleanup",
      submissionId: "submission-1",
      deploymentId: "pleomino",
      stagedReference: {
        rootBasename: "staged-artifacts",
        basename: "upload-1",
        sha256: "a".repeat(64),
      },
      cleanupError: "cleanup failed (EACCES)",
    },
  };
}
