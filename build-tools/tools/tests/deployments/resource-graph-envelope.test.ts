#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createDeploymentResourceEnvelopes,
  readDeploymentResourceEnvelopes,
} from "../../deployments/resource-graph-envelope";
import { createDeploymentResourceInventory } from "../../deployments/resource-graph-inventory";
import {
  admitControlPlaneRuntimeRecord,
  type DeploymentResourceInventory,
} from "../../deployments/resource-graph-types";
import {
  DEFAULT_NODE_LOCK_INDEX_PATH,
  DEFAULT_PROVIDER_INDEX_JSON_PATH,
} from "../../lib/workspace-state-paths";
import { cloudflareDeployment, cloudflareNodes } from "./deployment-contexts.scope.helpers";

test("resource envelopes wrap extracted deployment inventory without changing inventory errors", () => {
  const inventory = createDeploymentResourceInventory(
    cloudflareNodes([cloudflareDeployment({ provider_target: providerTarget() })]),
  );
  const result = createDeploymentResourceEnvelopes(inventory);
  assert.deepEqual(result.errors, []);
  assert.equal(result.inventory, inventory);
  const deployment = envelope(result.envelopes, "Deployment");
  assert.equal(deployment.apiVersion, "deployment.resource.viberoots.dev/v1");
  assert.equal(deployment.metadata.labels["viberoots.dev/authority"], "reviewed_intent");
  assert.match(deployment.metadata.uid, /^uid:deployment-resource:Deployment:/);
  assert.equal(deployment.statusRef, `status:${deployment.metadata.uid}`);
  assert.equal(deployment.source.class, "buck");
  assert.equal(deployment.policyRefs.length > 0, true);
  assert.equal(deployment.metadata.ownerReferences.length > 0, true);
});

test("resource envelopes cover extractable and runtime inventory kinds", () => {
  const inventory = createDeploymentResourceInventory(
    cloudflareNodes([cloudflareDeployment({ provider_target: providerTarget() })]),
    {
      runtimeSources: {
        executionSnapshots: [
          status("snapshot-1", {
            snapshotId: "snapshot-1",
            deploymentId: "sample-webapp",
            capturedAt: "2026-01-01T00:00:00.000Z",
          }),
        ],
        deployRuns: [
          status("run-1", { runId: "run-1", deploymentId: "sample-webapp", status: "ok" }),
        ],
      },
    },
  );
  const result = createDeploymentResourceEnvelopes(inventory);
  assert.deepEqual(result.errors, []);
  const kinds = new Set(result.envelopes.map((item) => item.kind));
  for (const expected of ["Deployment", "ProviderTarget", "LanePolicy", "DeployRun"]) {
    assert.equal(kinds.has(expected as never), true, expected);
  }
  const run = envelope(result.envelopes, "DeployRun");
  assert.equal(run.metadata.labels["viberoots.dev/authority"], "observed_runtime");
  assert.equal(run.evidenceRef, `evidence:${run.metadata.uid}`);
});

test("resource envelopes read through the shared composite deployment graph surface", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "resource-graph-envelope-"));
  try {
    await writeFile(
      tmp,
      ".viberoots/workspace/buck/graph.json",
      cloudflareNodes([cloudflareDeployment({ provider_target: providerTarget() })]),
    );
    await writeFile(tmp, DEFAULT_PROVIDER_INDEX_JSON_PATH, { "npm:fixture": { kind: "node" } });
    await writeFile(tmp, DEFAULT_NODE_LOCK_INDEX_PATH, { index: { fixture: "sha256:lock" } });
    const before = await listFiles(tmp);
    const result = await readDeploymentResourceEnvelopes({ workspaceRoot: tmp });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(await listFiles(tmp), before);
    assert.equal(result.inventory.graphRead.providerIndexAvailable, true);
    assert.equal(result.inventory.graphRead.nodeLockIndexAvailable, true);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("repo-owned intent envelope uids ignore source checkout paths", () => {
  const left = createDeploymentResourceEnvelopes(manualInventory("/nix/store/source-a"));
  const right = createDeploymentResourceEnvelopes(manualInventory("/Users/dev/viberoots"));
  assert.deepEqual(left.errors, []);
  assert.deepEqual(right.errors, []);
  assert.equal(left.envelopes[0].metadata.uid, right.envelopes[0].metadata.uid);
  assert.notDeepEqual(left.envelopes[0].source, right.envelopes[0].source);
});

test("resource envelopes reject secret-bearing runtime facts", () => {
  const inventory = createDeploymentResourceInventory([], {
    runtimeSources: {
      deployRuns: [
        status("run-1", {
          runId: "run-1",
          deploymentId: "sample-webapp",
          status: "ok",
          secret: "raw",
          rawToken: "raw",
        }),
      ],
    },
  });
  const result = createDeploymentResourceEnvelopes(inventory);
  assert.match(result.errors.join("\n"), /forbidden secret fields .*rawToken/);
  assert.match(result.errors.join("\n"), /forbidden secret fields .*secret/);

  const envelopeOnly = createDeploymentResourceEnvelopes({
    ...manualInventory("/tmp/source"),
    resources: [
      {
        kind: "DeployRun",
        id: "run-raw",
        authority: "observed_runtime",
        source: { class: "runtime" },
        facts: { runId: "run-raw", rawToken: "raw" },
      },
    ],
  });
  assert.match(envelopeOnly.errors.join("\n"), /spec.rawToken/);
});

function envelope(
  envelopes: ReturnType<typeof createDeploymentResourceEnvelopes>["envelopes"],
  kind: string,
) {
  const found = envelopes.find((item) => item.kind === kind);
  assert.ok(found, `${kind} envelope should exist`);
  return found;
}

function status(id: string, facts: Record<string, unknown>) {
  return admitControlPlaneRuntimeRecord({ id, facts });
}

function providerTarget() {
  return {
    account: "web-platform",
    project: "sample-webapp-staging",
  };
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
        id: "sample-webapp-prod",
        authority: "reviewed_intent",
        source: { class: "buck", label: "//projects/apps/sample-webapp:deploy", path: sourcePath },
        refs: ["provider", "lane", "admission"],
        facts: {
          provider: "cloudflare_pages",
          providerTargetIdentity: "provider",
          lanePolicyRef: "lane",
          admissionPolicyRef: "admission",
        },
      },
      manualResource("ProviderTarget", "provider", sourcePath),
      manualResource("LanePolicy", "lane", sourcePath),
      manualResource("AdmissionPolicy", "admission", sourcePath),
    ],
  };
}

function manualResource(
  kind: DeploymentResourceInventory["resources"][number]["kind"],
  id: string,
  sourcePath: string,
): DeploymentResourceInventory["resources"][number] {
  return {
    kind,
    id,
    authority: "reviewed_intent",
    source: { class: "buck", label: "//projects/apps/sample-webapp:deploy", path: sourcePath },
  };
}

async function writeFile(tmp: string, relPath: string, value: unknown) {
  const target = path.join(tmp, relPath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listFiles(root: string) {
  const out: string[] = [];
  async function walk(dir: string) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else out.push(path.relative(root, fullPath));
    }
  }
  await walk(root);
  return out.sort();
}
