#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { writeJson } from "./control-plane-http";
import { writeBackendControlPlaneMcpAuditEvent } from "./deployment-control-plane-audit";
import { readMcpJsonRequest } from "./deployment-control-plane-mcp-request";
import {
  readControlPlaneDeploymentDetail,
  readControlPlaneQueueSummary,
  readControlPlaneRuntimeStatus,
} from "./deployment-control-plane-read-model";
import { publicControlPlaneAuthContext } from "./deployment-control-plane-web-session";
import { requestHasReviewedBearerToken } from "./nixos-shared-host-control-plane-service-auth";
import type { ControlPlaneWebOptions } from "./deployment-control-plane-web-routes";
import { withBackendClient } from "./nixos-shared-host-control-plane-backend-db";

const MCP_TOOLS = [
  "deployment_control_plane_status",
  "deployment_queue",
  "deployment_detail",
  "deployment_auth_context",
] as const;
type McpToolName = (typeof MCP_TOOLS)[number];

const RESOURCE_PREFIX = "mcp://deployment-control-plane/";

export type ControlPlaneMcpOptions = ControlPlaneWebOptions;

export async function handleControlPlaneMcpRoute(opts: {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
  mcp: ControlPlaneMcpOptions;
}): Promise<boolean> {
  const pathname = stripBasePath(opts.url.pathname, opts.mcp.basePath);
  if (pathname === null) return false;
  if (!opts.mcp.enabled || opts.request.method !== "POST" || pathname !== "/") return false;
  if (!hasMcpAuth(opts.request, opts.mcp)) return unauthorized(opts.response);
  const requestId = requestIdFor(opts.request);
  const parsed = await readMcpJsonRequest(opts.request);
  if (!parsed.ok) {
    await auditMcp(opts.mcp, {
      requestId,
      operation: "mcp.parse",
      result: "failed",
      failureSummary: parsed.error,
    });
    writeJson(opts.response, 200, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "MCP request failed", requestId },
    });
    return true;
  }
  const response = await handleMcpRequest({ request: parsed.request, requestId, mcp: opts.mcp });
  writeJson(opts.response, 200, { jsonrpc: "2.0", id: parsed.request.id ?? null, ...response });
  return true;
}

async function handleMcpRequest(opts: {
  request: Record<string, any>;
  requestId: string;
  mcp: ControlPlaneMcpOptions;
}) {
  try {
    const result = await dispatchMcpRequest(opts);
    await auditMcp(opts.mcp, {
      requestId: opts.requestId,
      operation: operationFor(opts.request),
      deploymentId: deploymentIdFor(opts.request),
      result: "success",
    });
    return { result: { requestId: opts.requestId, ...result } };
  } catch (error) {
    await auditMcp(opts.mcp, {
      requestId: opts.requestId,
      operation: operationFor(opts.request),
      deploymentId: deploymentIdFor(opts.request),
      result: "failed",
      failureSummary: error instanceof Error ? error.message : String(error),
    });
    return { error: { code: -32602, message: "MCP request failed", requestId: opts.requestId } };
  }
}

async function dispatchMcpRequest(opts: {
  request: Record<string, any>;
  requestId: string;
  mcp: ControlPlaneMcpOptions;
}) {
  if (opts.request.method === "tools/list") return { tools: MCP_TOOLS.map(toolDescriptor) };
  if (opts.request.method === "resources/list")
    return { resources: MCP_TOOLS.map(resourceDescriptor) };
  if (opts.request.method === "tools/call") {
    return await readMcpTool(opts.mcp, opts.request.params?.name, opts.request.params?.arguments);
  }
  if (opts.request.method === "resources/read") {
    const resource = resourceRequest(String(opts.request.params?.uri || ""));
    return await readMcpTool(opts.mcp, resource.name, resource.arguments);
  }
  throw new Error("unsupported MCP method");
}

async function readMcpTool(mcp: ControlPlaneMcpOptions, name: string, args: any = {}) {
  if (!isMcpTool(name)) throw new Error(`unsupported MCP tool: ${name}`);
  if (name === "deployment_control_plane_status") {
    return { tool: name, data: await readControlPlaneRuntimeStatus(mcp) };
  }
  if (name === "deployment_queue") {
    return { tool: name, data: await readControlPlaneQueueSummary(mcp.backend) };
  }
  if (name === "deployment_auth_context") {
    return { tool: name, data: publicControlPlaneAuthContext(defaultMcpPrincipal()) };
  }
  const deploymentId = String(args?.deploymentId || "").trim();
  if (!deploymentId) throw new Error("deployment_detail requires deploymentId");
  return { tool: name, data: await readControlPlaneDeploymentDetail(mcp.backend, deploymentId) };
}

function defaultMcpPrincipal() {
  return {
    principal: { kind: "service_token" as const, principalId: "reviewed-service-token" },
    grants: {
      read: true as const,
      mutations: false as const,
      deployments: "authorized_scope" as const,
    },
  };
}

function hasMcpAuth(request: http.IncomingMessage, opts: ControlPlaneMcpOptions) {
  return requestHasReviewedBearerToken({
    authorizationHeader: request.headers.authorization,
    serviceToken: opts.token,
    localFixture: opts.localFixture,
    env: opts.env,
  });
}

async function auditMcp(
  mcp: ControlPlaneMcpOptions,
  event: {
    requestId: string;
    operation: string;
    deploymentId?: string;
    result: "success" | "failed";
    failureSummary?: string;
  },
) {
  await withBackendClient(mcp.backend, async (client) => {
    await writeBackendControlPlaneMcpAuditEvent({ client, ...event });
  });
}

function toolDescriptor(name: McpToolName) {
  return { name, description: `Read ${name.replaceAll("_", " ")}`, inputSchema: inputSchema(name) };
}

function resourceDescriptor(name: McpToolName) {
  if (name === "deployment_control_plane_status") return { uri: `${RESOURCE_PREFIX}status`, name };
  if (name === "deployment_queue") return { uri: `${RESOURCE_PREFIX}queue`, name };
  if (name === "deployment_auth_context") return { uri: `${RESOURCE_PREFIX}auth-context`, name };
  return {
    uriTemplate: `${RESOURCE_PREFIX}deployments/{deploymentId}`,
    name,
    description: "Read one deployment detail by deployment id",
  };
}

function inputSchema(name: McpToolName) {
  return name === "deployment_detail"
    ? {
        type: "object",
        properties: { deploymentId: { type: "string" } },
        required: ["deploymentId"],
      }
    : { type: "object", properties: {} };
}

function isMcpTool(name: string): name is McpToolName {
  return (MCP_TOOLS as readonly string[]).includes(name);
}

function resourceRequest(uri: string): { name: McpToolName; arguments: Record<string, string> } {
  if (uri === `${RESOURCE_PREFIX}status`)
    return { name: "deployment_control_plane_status", arguments: {} };
  if (uri === `${RESOURCE_PREFIX}queue`) return { name: "deployment_queue", arguments: {} };
  if (uri === `${RESOURCE_PREFIX}auth-context`)
    return { name: "deployment_auth_context", arguments: {} };
  const deployment = uri.match(/^mcp:\/\/deployment-control-plane\/deployments\/([^/]+)$/);
  if (deployment) {
    return {
      name: "deployment_detail",
      arguments: { deploymentId: decodeURIComponent(deployment[1]) },
    };
  }
  throw new Error(`unsupported MCP resource: ${uri}`);
}

function operationFor(request: Record<string, any>): string {
  const name = request.params?.name || resourceRequestForOperation(request.params?.uri);
  return name ? `mcp.${name}` : `mcp.${request.method || "unknown"}`;
}

function deploymentIdFor(request: Record<string, any>): string | undefined {
  return (
    String(request.params?.arguments?.deploymentId || "").trim() ||
    deploymentIdFromResource(request.params?.uri) ||
    undefined
  );
}

function resourceRequestForOperation(uri: unknown): string {
  if (!uri) return "";
  try {
    return resourceRequest(String(uri)).name;
  } catch {
    return "";
  }
}

function deploymentIdFromResource(uri: unknown): string {
  const match = String(uri || "").match(/^mcp:\/\/deployment-control-plane\/deployments\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function requestIdFor(request: http.IncomingMessage): string {
  return String(request.headers["x-request-id"] || "").trim() || crypto.randomUUID();
}

function stripBasePath(pathname: string, basePath: string): string | null {
  if (basePath === "/") return pathname;
  if (pathname === basePath) return "/";
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : null;
}

function unauthorized(response: http.ServerResponse): true {
  writeJson(response, 401, { error: "unauthorized" });
  return true;
}
