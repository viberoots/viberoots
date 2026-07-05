#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { SourcePlanEvidence } from "../../lib/source-plan-evidence";
import { readBackendControlPlaneAuditEvents } from "../../deployments/deployment-control-plane-audit";
import {
  createDeploymentResourceGraphDocuments,
  type ResourceGraphEdgeDocument,
  type ResourceGraphNodeDocument,
} from "../../deployments/resource-graph-export";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_BACKEND_SCHEMA_SQL } from "../../deployments/nixos-shared-host-control-plane-backend-schema";
import {
  PRESERVED_CONTROL_PLANE_TABLES,
  RESOURCE_GRAPH_READ_MODEL_TABLES,
} from "../../deployments/resource-graph-read-model-tables";
import {
  localHarnessControlPlaneDatabaseUrl,
  readBackendResourceGraphIndex,
  syncBackendResourceGraphIndex,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { runInTemp } from "../lib/test-helpers";

const TOKEN = "resource-graph-token";

test("resource graph schema classifies existing control-plane tables as preserved authority", () => {
  const tables = [
    ...NIXOS_SHARED_HOST_CONTROL_PLANE_BACKEND_SCHEMA_SQL.matchAll(
      /CREATE TABLE IF NOT EXISTS ([a-z_]+)/g,
    ),
  ].map((match) => match[1]);
  const indexed = new Set<string>(RESOURCE_GRAPH_READ_MODEL_TABLES);
  const preserved = new Set<string>(PRESERVED_CONTROL_PLANE_TABLES);
  const unclassified = tables.filter((table) => !indexed.has(table) && !preserved.has(table));
  assert.deepEqual(unclassified, []);
  assert.ok(preserved.has("submissions"));
  assert.ok(preserved.has("queue"));
  assert.ok(preserved.has("current_stage_state"));
  assert.ok(indexed.has("resource_graph_nodes"));
});

test("resource graph read model indexes intent nodes, edges, and safe source selection", async () => {
  await runInTemp("resource-graph-read-model-index", async (tmp) => {
    const backend = backendFor(tmp);
    const fixture = fixtureDocuments();
    await syncBackendResourceGraphIndex(backend, {
      ...fixture,
      sourceRef: "workspace-resource-graph-export",
      importedAt: "2026-07-05T12:00:00.000Z",
    });
    const model = await readBackendResourceGraphIndex(backend);
    assert.equal(model.schemaVersion, "control-plane-resource-graph@1");
    assert.equal(model.nodes.length, 3);
    assert.equal(model.edges.length, 3);
    assert.equal(model.runtime.indexed, true);
    assert.equal(model.runtime.status, "runtime-linked");
    assert.equal(model.runtime.nodeCount, 0);
    const deployment = model.nodes.find((node: any) => node.kind === "Deployment") as any;
    assert.equal(deployment.sourceSelection.nixpkgs_profile, "profile_app");
    assert.deepEqual(deployment.sourceSelection.nixpkg_pins, {
      "pkgs.zlib": { nixpkgs_profile: "nixpkgs_23_11" },
    });
    assert.doesNotMatch(JSON.stringify(model), /github:NixOS|0123456789abcdef|rawToken/);
  });
});

test("resource graph reads work through web, service, and MCP read surfaces", async () => {
  await runInTemp("resource-graph-read-model-routes", async (tmp) => {
    const backend = backendFor(tmp);
    await syncBackendResourceGraphIndex(backend, {
      ...fixtureDocuments(),
      sourceRef: "workspace-resource-graph-export",
    });
    const service = await startService(tmp, backend);
    try {
      const headers = { authorization: `Bearer ${TOKEN}`, "x-request-id": "rg-web-123" };
      const web = await readJson<any>(
        await fetch(new URL("/ops/api/v1/read/resource-graph", service.url), { headers }),
      );
      assert.equal(
        web.nodes.some((node: any) => node.kind === "Deployment"),
        true,
      );
      assert.equal(web.runtime.status, "runtime-linked");
      const directHeaders = {
        authorization: `Bearer ${TOKEN}`,
        "x-request-id": "rg-direct-123",
      };
      const direct = await readJson<any>(
        await fetch(new URL("/api/v1/resource-graph", service.url), { headers: directHeaders }),
      );
      assert.equal(direct.edges.length, web.edges.length);
      const mcp = await callMcp(service.url, "deployment_resource_graph", "rg-mcp-123");
      assert.equal(mcp.result.tool, "deployment_resource_graph");
      assert.equal(mcp.result.data.nodes.length, web.nodes.length);
      const audit = await readBackendControlPlaneAuditEvents(backend, "control-plane");
      assert.ok(audit.some((event) => event.requestId === "rg-web-123"));
      assert.ok(audit.some((event) => event.requestId === "rg-direct-123"));
      assert.ok(audit.some((event) => event.requestId === "rg-mcp-123"));
    } finally {
      await service.close();
    }
  });
});

function backendFor(tmp: string) {
  const recordsRoot = path.join(tmp, "records");
  return { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
}

async function startService(tmp: string, backend: { recordsRoot: string; databaseUrl: string }) {
  return await startNixosSharedHostControlPlaneServer({
    workspaceRoot: tmp,
    paths: {
      statePath: path.join(tmp, "state.json"),
      hostRoot: tmp,
      recordsRoot: backend.recordsRoot,
    },
    backendDatabaseUrl: backend.databaseUrl,
    token: TOKEN,
    objectStore: memoryControlPlaneArtifactStore(),
    webUi: { enabled: true, basePath: "/ops" },
    mcp: { enabled: true, basePath: "/mcp" },
  });
}

function fixtureDocuments(): {
  nodes: ResourceGraphNodeDocument;
  edges: ResourceGraphEdgeDocument;
  sourcePlans: SourcePlanEvidence[];
} {
  const documents = createDeploymentResourceGraphDocuments({
    apiVersion: "deployment-resource-envelope-list@1",
    inventory: {} as any,
    errors: [],
    envelopes: [
      envelope("Deployment", "demo-web", "uid:deployment", []),
      envelope("ProviderTarget", "provider-target", "uid:provider", ["uid:deployment"]),
    ],
  });
  return {
    nodes: documents.nodes,
    edges: documents.edges,
    sourcePlans: [
      {
        target: "//demo:deploy",
        nixpkgs_profile: "profile_app",
        nixpkg_pins: { "pkgs.zlib": { nixpkgs_profile: "nixpkgs_23_11" } },
      },
    ],
  };
}

function envelope(kind: string, name: string, uid: string, ownerUids: string[]) {
  return {
    apiVersion: "deployment.resource.viberoots.dev/v1",
    kind,
    metadata: {
      name,
      uid,
      labels: { "viberoots.dev/authority": "reviewed_intent" },
      ownerReferences: ownerUids.map((owner) => ({
        apiVersion: "deployment.resource.viberoots.dev/v1",
        kind: "Deployment",
        name: "demo-web",
        uid: owner,
      })),
    },
    spec: {},
    statusRef: `status:${uid}`,
    policyRefs: [],
    source: { class: "buck", label: "//demo:deploy" },
  } as any;
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status !== 200) assert.fail(await response.text());
  return (await response.json()) as T;
}

async function callMcp(serviceUrl: string, tool: string, requestId: string) {
  const response = await fetch(new URL("/mcp", serviceUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: { name: tool, arguments: {} },
    }),
  });
  return await readJson<any>(response);
}
