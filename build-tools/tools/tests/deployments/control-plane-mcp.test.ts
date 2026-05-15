#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { readBackendControlPlaneAuditEvents } from "../../deployments/deployment-control-plane-audit";
import {
  MCP_TEST_TOKEN,
  mcpBackendFor,
  mcpServiceFor,
  seedMcpSecretBearingState,
} from "./control-plane-mcp.helpers";
import { runInTemp } from "../lib/test-helpers";

const TOOL_NAMES = [
  "deployment_control_plane_status",
  "deployment_queue",
  "deployment_detail",
  "deployment_auth_context",
];
const RESOURCE_CASES = [
  { name: "deployment_control_plane_status", uri: "mcp://deployment-control-plane/status" },
  { name: "deployment_queue", uri: "mcp://deployment-control-plane/queue" },
  {
    name: "deployment_detail",
    uri: "mcp://deployment-control-plane/deployments/demo-mcp",
  },
  { name: "deployment_auth_context", uri: "mcp://deployment-control-plane/auth-context" },
];

test("HTTP MCP tools require auth and return redacted read models", async () => {
  await runInTemp("control-plane-mcp-contract", async (tmp) => {
    const backend = mcpBackendFor(tmp);
    await seedMcpSecretBearingState(backend, tmp);
    const service = await mcpServiceFor(tmp, backend);
    try {
      assert.equal((await fetch(new URL("/mcp", service.url), { method: "POST" })).status, 401);
      const listed = await callMcp(service.url, "tools/list", {}, "mcp-list");
      assert.deepEqual(
        listed.result.tools.map((tool: any) => tool.name),
        TOOL_NAMES,
      );
      assert.doesNotMatch(JSON.stringify(listed), /submit|approve|run_action|mutation/i);
      for (const name of TOOL_NAMES) {
        await expectUnauthorizedMcp(service.url, "tools/call", {
          name,
          arguments: toolArguments(name),
        });
        const response = await callMcp(
          service.url,
          "tools/call",
          { name, arguments: toolArguments(name) },
          `mcp-${name}`,
        );
        assert.equal(response.result.tool, name);
        assert.equal(response.result.requestId, `mcp-${name}`);
        assertRedacted(response);
      }
    } finally {
      await service.close();
    }
  });
});

test("HTTP MCP resources require auth and return redacted read models", async () => {
  await runInTemp("control-plane-mcp-resources", async (tmp) => {
    const backend = mcpBackendFor(tmp);
    await seedMcpSecretBearingState(backend, tmp);
    const service = await mcpServiceFor(tmp, backend);
    try {
      const listed = await callMcp(service.url, "resources/list", {}, "mcp-resource-list");
      assert.deepEqual(
        listed.result.resources.map((resource: any) => resource.name),
        TOOL_NAMES,
      );
      assert.ok(
        listed.result.resources.some((resource: any) =>
          String(resource.uriTemplate || "").endsWith("/deployments/{deploymentId}"),
        ),
      );
      for (const resource of RESOURCE_CASES) {
        await expectUnauthorizedMcp(service.url, "resources/read", { uri: resource.uri });
        const response = await callMcp(
          service.url,
          "resources/read",
          { uri: resource.uri },
          `mcp-resource-${resource.name}`,
        );
        assert.equal(response.result.tool, resource.name);
        assert.equal(response.result.requestId, `mcp-resource-${resource.name}`);
        assertRedacted(response);
      }
    } finally {
      await service.close();
    }
  });
});

test("MCP responses carry request ids that map to audit events", async () => {
  await runInTemp("control-plane-mcp-audit", async (tmp) => {
    const backend = mcpBackendFor(tmp);
    await seedMcpSecretBearingState(backend, tmp);
    const service = await mcpServiceFor(tmp, backend);
    try {
      const resources = await callMcp(service.url, "resources/list", {}, "mcp-resources");
      assert.equal(resources.result.requestId, "mcp-resources");
      assert.equal(resources.result.resources.length, TOOL_NAMES.length);
      await callMcp(
        service.url,
        "tools/call",
        { name: "deployment_detail", arguments: { deploymentId: "demo-mcp" } },
        "mcp-detail-audit",
      );
      const controlPlaneAudit = await readBackendControlPlaneAuditEvents(backend, "control-plane");
      const deploymentAudit = await readBackendControlPlaneAuditEvents(backend, "demo-mcp");
      assert.ok(controlPlaneAudit.some((event) => event.requestId === "mcp-resources"));
      assert.ok(deploymentAudit.some((event) => event.requestId === "mcp-detail-audit"));
      assert.ok(deploymentAudit.some((event) => event.operation === "mcp.deployment_detail"));
    } finally {
      await service.close();
    }
  });
});

test("MCP disabled mode and fixture-only unauthenticated mode are enforced", async () => {
  await runInTemp("control-plane-mcp-disabled-fixture", async (tmp) => {
    const backend = mcpBackendFor(tmp);
    const disabled = await mcpServiceFor(tmp, backend, {
      mcp: { enabled: false, basePath: "/mcp" },
    });
    try {
      assert.equal((await fetch(new URL("/mcp", disabled.url), { method: "POST" })).status, 404);
    } finally {
      await disabled.close();
    }
    const protectedService = await mcpServiceFor(tmp, backend);
    try {
      assert.equal(
        (await fetch(new URL("/mcp", protectedService.url), { method: "POST" })).status,
        401,
      );
    } finally {
      await protectedService.close();
    }
    const fixture = await mcpServiceFor(tmp, backend, { localFixture: true, token: undefined });
    try {
      const response = await callMcp(fixture.url, "tools/list", {}, "fixture-mcp", false);
      assert.equal(response.result.tools.length, TOOL_NAMES.length);
    } finally {
      await fixture.close();
    }
  });
});

function toolArguments(name: string) {
  return name === "deployment_detail" ? { deploymentId: "demo-mcp" } : {};
}

function assertRedacted(value: unknown) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /super-secret|Bearer leaked|env-dump-secret|artifact-secret/,
  );
}

async function expectUnauthorizedMcp(
  serviceUrl: string,
  method: string,
  params: Record<string, unknown>,
) {
  const response = await mcpFetch(serviceUrl, method, params, `unauth-${method}`, false);
  assert.equal(response.status, 401);
}

async function callMcp(
  serviceUrl: string,
  method: string,
  params: Record<string, unknown>,
  requestId: string,
  authorized = true,
) {
  const response = await mcpFetch(serviceUrl, method, params, requestId, authorized);
  assert.equal(response.status, 200);
  return (await response.json()) as any;
}

async function mcpFetch(
  serviceUrl: string,
  method: string,
  params: Record<string, unknown>,
  requestId: string,
  authorized: boolean,
) {
  return await fetch(new URL("/mcp", serviceUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      ...(authorized ? { authorization: `Bearer ${MCP_TEST_TOKEN}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
  });
}
