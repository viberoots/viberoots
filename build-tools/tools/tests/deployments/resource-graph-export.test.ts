#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exportDeploymentResourceGraph } from "../../deployments/resource-graph-export";
import {
  DEFAULT_NODE_LOCK_INDEX_PATH,
  DEFAULT_PROVIDER_INDEX_JSON_PATH,
  DEFAULT_RESOURCE_GRAPH_EDGES_PATH,
  DEFAULT_RESOURCE_GRAPH_ENVELOPES_PATH,
  DEFAULT_RESOURCE_GRAPH_NODES_PATH,
} from "../../lib/workspace-state-paths";
import { cloudflareDeployment, cloudflareNodes } from "./deployment-contexts.scope.helpers";

test("resource graph export writes deterministic workspace-state documents", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "resource-graph-export-"));
  try {
    await writeJson(
      tmp,
      ".viberoots/workspace/buck/graph.json",
      cloudflareNodes([cloudflareDeployment({ provider_target: providerTarget() })]),
    );
    await writeJson(tmp, DEFAULT_PROVIDER_INDEX_JSON_PATH, { "npm:fixture": { kind: "node" } });
    await writeJson(tmp, DEFAULT_NODE_LOCK_INDEX_PATH, { index: { fixture: "sha256:lock" } });

    const first = await exportDeploymentResourceGraph({ workspaceRoot: tmp });
    const snapshot = await readOutputs(tmp);
    const second = await exportDeploymentResourceGraph({ workspaceRoot: tmp });

    assert.deepEqual(second, first);
    assert.deepEqual(await readOutputs(tmp), snapshot);
    assert.equal(first.envelopesPath, path.join(tmp, DEFAULT_RESOURCE_GRAPH_ENVELOPES_PATH));
    assert.equal(first.nodesPath, path.join(tmp, DEFAULT_RESOURCE_GRAPH_NODES_PATH));
    assert.equal(first.edgesPath, path.join(tmp, DEFAULT_RESOURCE_GRAPH_EDGES_PATH));
    assert.equal(snapshot.nodes.apiVersion, "viberoots.resource-graph.nodes@1");
    assert.equal(snapshot.edges.apiVersion, "viberoots.resource-graph.edges@1");
    assert.ok(snapshot.nodes.nodes.some((node: any) => node.kind === "Deployment"));
    assert.ok(snapshot.edges.edges.some((edge: any) => edge.kind === "provider_target"));
    assert.ok(snapshot.edges.edges.some((edge: any) => edge.kind === "source"));
    assert.equal(
      await exists(path.join(tmp, ".viberoots", "workspace", "providers", "TARGETS")),
      false,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

function providerTarget() {
  return { account: "web-platform", project: "sample-webapp-staging" };
}

async function writeJson(root: string, relPath: string, value: unknown): Promise<void> {
  const file = path.join(root, relPath);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readOutputs(root: string) {
  const read = async (relPath: string) =>
    JSON.parse(await fsp.readFile(path.join(root, relPath), "utf8"));
  return {
    envelopes: await read(DEFAULT_RESOURCE_GRAPH_ENVELOPES_PATH),
    nodes: await read(DEFAULT_RESOURCE_GRAPH_NODES_PATH),
    edges: await read(DEFAULT_RESOURCE_GRAPH_EDGES_PATH),
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}
