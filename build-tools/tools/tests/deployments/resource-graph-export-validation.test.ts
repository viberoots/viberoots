#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDeploymentResourceEnvelopes } from "../../deployments/resource-graph-envelope";
import {
  createDeploymentResourceGraphDocuments,
  exportDeploymentResourceGraph,
} from "../../deployments/resource-graph-export";
import { createDeploymentResourceInventory } from "../../deployments/resource-graph-inventory";
import type {
  DeploymentResourceInventory,
  DeploymentResourceInventoryEntry,
} from "../../deployments/resource-graph-types";
import {
  DEFAULT_NODE_LOCK_INDEX_PATH,
  DEFAULT_PROVIDER_INDEX_JSON_PATH,
  DEFAULT_RESOURCE_GRAPH_EDGES_PATH,
  DEFAULT_RESOURCE_GRAPH_NODES_PATH,
} from "../../lib/workspace-state-paths";
import { cloudflareDeployment, cloudflareNodes } from "./deployment-contexts.scope.helpers";

test("export validation rejects invalid refs and source labels", () => {
  assert.match(errors([entry("Component", "bad", [], {}, "not-a-label")]), /invalid source label/);
  assert.match(
    errors([
      deployment(["lane", "admission"], { providerTargetIdentity: "missing" }),
      entry("LanePolicy", "lane"),
      entry("AdmissionPolicy", "admission"),
    ]),
    /providerTargetIdentity unresolved: missing.*missing ProviderTarget ref/s,
  );
  assert.match(
    errors([
      deployment(["provider", "lane", "admission"]),
      entry("ProviderTarget", "provider"),
      entry("Component", "lane"),
      entry("AdmissionPolicy", "admission"),
    ]),
    /lanePolicyRef must reference LanePolicy, got Component/,
  );
  assert.match(
    errors([
      deployment(["provider", "lane", "admission", "bad-requirement"], {
        secretRequirementRefs: ["bad-requirement"],
      }),
      entry("ProviderTarget", "provider"),
      entry("LanePolicy", "lane"),
      entry("AdmissionPolicy", "admission"),
      entry("Component", "bad-requirement"),
    ]),
    /secretRequirementRefs must reference SecretRequirement, got Component/,
  );
});

test("graph-first export matches helper-produced documents for the same extracted graph", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "resource-graph-equivalence-"));
  try {
    const graph = cloudflareNodes([cloudflareDeployment({ provider_target: providerTarget() })]);
    await writeJson(tmp, ".viberoots/workspace/buck/graph.json", graph);
    await writeJson(tmp, DEFAULT_PROVIDER_INDEX_JSON_PATH, { "npm:fixture": { kind: "node" } });
    await writeJson(tmp, DEFAULT_NODE_LOCK_INDEX_PATH, { index: { fixture: "sha256:lock" } });
    await exportDeploymentResourceGraph({ workspaceRoot: tmp });
    const expected = documentsFor(
      createDeploymentResourceInventory(graph, {
        workspaceRoot: tmp,
        sidecars: { providerIndexAvailable: true, nodeLockIndexAvailable: true },
      }),
    );
    assert.deepEqual(await readJson(tmp, DEFAULT_RESOURCE_GRAPH_NODES_PATH), expected.nodes);
    assert.deepEqual(await readJson(tmp, DEFAULT_RESOURCE_GRAPH_EDGES_PATH), expected.edges);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("resource graph export classifies Buck-query fallback outside export scope", async () => {
  const root = await findViberootsRoot();
  const exportSource = await fsp.readFile(
    path.join(root, "build-tools", "tools", "deployments", "resource-graph-export.ts"),
    "utf8",
  );
  const querySource = await fsp.readFile(
    path.join(root, "build-tools", "tools", "deployments", "deployment-query.ts"),
    "utf8",
  );
  const docs = await fsp.readFile(path.join(root, "docs", "deployments-contract.md"), "utf8");

  assert.match(exportSource, /ensureDeploymentGraph\(workspaceRoot\)/);
  assert.match(exportSource, /readDeploymentResourceEnvelopes\(\{ workspaceRoot \}\)/);
  assert.doesNotMatch(exportSource, /queryDeploymentNodes|resolveDeploymentFromTarget/);
  assert.match(querySource, /buck2 .* cquery/s);
  assert.match(querySource, /resolveAllDeployments\(workspaceRoot\)/);
  assert.match(docs, /Buck-query fallback is intentionally outside `resource-graph export` scope/);
});

function documentsFor(inventory: DeploymentResourceInventory) {
  const envelopes = createDeploymentResourceEnvelopes(inventory);
  assert.deepEqual(envelopes.errors, []);
  return createDeploymentResourceGraphDocuments(envelopes);
}

function deployment(
  refs: string[],
  facts: Record<string, unknown> = {},
): DeploymentResourceInventoryEntry {
  return entry("Deployment", "deploy", refs, {
    providerTargetIdentity: facts.providerTargetIdentity || "provider",
    lanePolicyRef: facts.lanePolicyRef || "lane",
    admissionPolicyRef: facts.admissionPolicyRef || "admission",
    secretRequirementRefs: facts.secretRequirementRefs || [],
  });
}

function entry(
  kind: DeploymentResourceInventoryEntry["kind"],
  id: string,
  refs: string[] = [],
  facts: Record<string, unknown> = {},
  label = "//projects/deployments/demo:deploy",
): DeploymentResourceInventoryEntry {
  return {
    kind,
    id,
    authority: "reviewed_intent",
    source: { class: "buck", label },
    refs,
    facts,
  };
}

function inventory(resources: DeploymentResourceInventoryEntry[]): DeploymentResourceInventory {
  return {
    taxonomyVersion: "deployment-resource-taxonomy@1",
    resources,
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
  };
}

function errors(resources: DeploymentResourceInventoryEntry[]): string {
  return createDeploymentResourceEnvelopes(inventory(resources)).errors.join("\n");
}

function providerTarget() {
  return { account: "web-platform", project: "sample-webapp-staging" };
}

async function writeJson(root: string, relPath: string, value: unknown): Promise<void> {
  const file = path.join(root, relPath);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(root: string, relPath: string): Promise<unknown> {
  return JSON.parse(await fsp.readFile(path.join(root, relPath), "utf8"));
}

async function findViberootsRoot(): Promise<string> {
  for (const candidate of [path.join(process.cwd(), "viberoots"), process.cwd()]) {
    try {
      await fsp.access(path.join(candidate, "init"));
      return candidate;
    } catch {}
  }
  throw new Error("could not find viberoots root");
}
