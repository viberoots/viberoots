#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { readBackendControlPlaneAuditEvents } from "../../deployments/deployment-control-plane-audit";
import { CONTROL_PLANE_WEB_UI_JS } from "../../deployments/deployment-control-plane-web-ui";
import { runResourceGraphForOperator } from "../../deployments/deploy-resource-graph-operator";
import { runInTemp } from "../lib/test-helpers";
import {
  RESOURCE_GRAPH_E2E_TOKEN,
  runCloudflarePagesGraphSequence,
  withCloudflarePagesResourceGraphE2E,
} from "./cloudflare-pages.resource-graph-e2e.helpers";
import { importExportedGraph } from "./cloudflare-pages.resource-graph-import.helpers";

test("Cloudflare Pages reconciler path publishes linked resource graph status", async () => {
  await runInTemp("cloudflare-pages-resource-graph-e2e", async (tmp, $) => {
    await withCloudflarePagesResourceGraphE2E(tmp, $, async (ctx) => {
      const runs = await runCloudflarePagesGraphSequence(ctx, $);
      assert.equal(runs.first.finalOutcome, "succeeded");
      assert.equal(runs.second.finalOutcome, "succeeded");
      assert.equal(runs.rollback.finalOutcome, "succeeded");

      await importExportedGraph(ctx);
      const headers = {
        authorization: `Bearer ${RESOURCE_GRAPH_E2E_TOKEN}`,
        "x-request-id": "rg-e2e-api",
      };
      const directResponse = await fetch(new URL("/api/v1/resource-graph", ctx.controlPlane.url), {
        headers,
      });
      assert.equal(directResponse.headers.get("x-request-id"), "rg-e2e-api");
      const direct = await readJson<any>(directResponse);
      assert.equal(direct.schemaVersion, "control-plane-resource-graph@1");
      assert.equal(
        direct.runtime.status,
        "runtime-linked",
        JSON.stringify(direct.runtime.markers, null, 2),
      );
      assertHasNode(direct, "Deployment", ctx.deployment.deploymentId);
      assertHasNode(direct, "ProviderTarget", ctx.deployment.providerTarget.identity);
      assertHasNode(direct, "ArtifactChallenge");
      assertHasNode(direct, "StaticWebappUploadSession");
      assertHasNode(direct, "WorkerEvidence", "resource-graph-e2e-worker");
      assertHasNode(direct, "CurrentStageState", `${ctx.deployment.deploymentId}:staging`);
      assertHasNode(direct, "StageHistoryEntry");
      const rollback = nodeFor(direct, "DeployRun", runs.rollback.deployRunId);
      assert.equal(rollback?.facts?.operationKind, "rollback");
      const rollbackSubmissionId = String(rollback?.facts?.controlPlane?.submissionId || "");
      assert.match(rollbackSubmissionId, /^cp-/);
      assert.ok((rollback?.facts?.policyResourceRefs || []).length > 0);
      assert.ok(
        direct.edges.some(
          (edge: any) =>
            edge.kind === "policy" &&
            edge.fromKind === "DeployRun" &&
            edge.fromUid === rollback.uid,
        ),
      );
      assert.ok(
        direct.runtime.latestActions.some(
          (action: any) =>
            action.submissionId === rollbackSubmissionId && action.actionId.length > 0,
        ),
      );
      const provider = nodeFor(direct, "ProviderEvidence", runs.rollback.deployRunId);
      assert.equal(provider?.facts?.provider, "cloudflare-pages");
      const stageState = nodeFor(
        direct,
        "CurrentStageState",
        `${ctx.deployment.deploymentId}:staging`,
      );
      assert.equal(stageState?.facts?.currentRunId, runs.rollback.deployRunId);
      assertHasNode(
        direct,
        "StageHistoryEntry",
        `${ctx.deployment.deploymentId}:staging:${runs.rollback.deployRunId}`,
      );
      assert.ok(direct.runtime.workerEvidenceCount >= 1);
      assert.ok(direct.edges.some((edge: any) => edge.kind === "provider_target"));
      assertSecretSafe(direct);

      const webResponse = await fetch(
        new URL("/ops/api/v1/read/resource-graph", ctx.controlPlane.url),
        { headers: { ...headers, "x-request-id": "rg-e2e-web" } },
      );
      assert.equal(webResponse.headers.get("x-request-id"), "rg-e2e-web");
      const web = await readJson<any>(webResponse);
      assert.equal(web.schemaVersion, direct.schemaVersion);
      assert.equal(web.runtime.status, direct.runtime.status);
      const authResponse = await fetch(
        new URL("/ops/api/v1/read/auth-context", ctx.controlPlane.url),
        {
          headers: { ...headers, "x-request-id": "rg-e2e-auth" },
        },
      );
      assert.equal(authResponse.headers.get("x-request-id"), "rg-e2e-auth");
      const auth = await readJson<any>(authResponse);
      assert.equal(auth.grants.read, true);
      assert.equal(auth.grants.mutations, false);
      const renderedUi = await renderResourceGraphUi(ctx.controlPlane.url);
      assert.match(renderedUi.html, /Resource Graph/);
      assert.match(renderedUi.html, /control-plane-resource-graph@1/);
      assert.match(renderedUi.html, /runtime-linked/);
      assert.equal(renderedUi.reads.length, 1);
      assert.equal(renderedUi.reads[0].requestId, "ui-rg-e2e-render");
      assert.equal(renderedUi.reads[0].responseRequestId, "ui-rg-e2e-render");
      assert.equal(renderedUi.reads[0].schemaVersion, direct.schemaVersion);
      assert.equal(renderedUi.reads[0].runtimeStatus, direct.runtime.status);
      assertSecretSafe(renderedUi);
      const mcp = await callMcp(ctx.controlPlane.url);
      assert.equal(mcp.result.requestId, "rg-e2e-mcp");
      assert.equal(mcp.result.data.runtime.status, direct.runtime.status);
      const cli = JSON.parse(
        await captureStdout(() =>
          runResourceGraphForOperator({
            controlPlaneUrl: ctx.controlPlane.url,
            controlPlaneToken: RESOURCE_GRAPH_E2E_TOKEN,
            selectedSource: "explicit",
            requestId: "rg-e2e-cli",
          }),
        ),
      );
      assert.equal(cli.schemaVersion, direct.schemaVersion);
      assert.equal(cli.runtime.status, direct.runtime.status);
      assertSecretSafe({ web, mcp, cli });

      const audit = await readBackendControlPlaneAuditEvents(ctx.backend, "control-plane");
      assert.ok(audit.some((event) => event.requestId === "rg-e2e-api"));
      assert.ok(audit.some((event) => event.requestId === "rg-e2e-web"));
      assert.ok(audit.some((event) => event.requestId === "rg-e2e-mcp"));
      assert.ok(audit.some((event) => event.requestId === "rg-e2e-cli"));
      assert.ok(audit.some((event) => event.requestId === "rg-e2e-auth"));
      assert.ok(audit.some((event) => event.requestId === "ui-rg-e2e-render"));
    });
  });
});

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body) as T;
}

async function callMcp(serviceUrl: string) {
  return await readJson<any>(
    await fetch(new URL("/mcp", serviceUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${RESOURCE_GRAPH_E2E_TOKEN}`,
        "x-request-id": "rg-e2e-mcp",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "rg-e2e-mcp",
        method: "tools/call",
        params: { name: "deployment_resource_graph", arguments: {} },
      }),
    }),
  );
}

async function renderResourceGraphUi(serviceUrl: string) {
  const session = await readJson<any>(
    await fetch(new URL("/ops/api/v1/web/session", serviceUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${RESOURCE_GRAPH_E2E_TOKEN}` },
    }),
  );
  assert.equal(session.grants.read, true);
  assert.equal(session.grants.mutations, false);
  const app = { innerHTML: "Loading..." };
  const reads: Array<{
    requestId: string;
    responseRequestId: string | null;
    schemaVersion: string;
    runtimeStatus: string;
  }> = [];
  const context = vm.createContext({
    window: {
      __CONTROL_PLANE_BASE_PATH__: "/ops",
      crypto: { randomUUID: () => "rg-e2e-render" },
      localStorage: { getItem: () => session.sessionId },
    },
    location: { pathname: "/ops/resource-graph", search: "" },
    document: { getElementById: () => app },
    URLSearchParams,
    fetch: async (input: string, init?: RequestInit) => {
      const response = await fetch(new URL(input, serviceUrl), init);
      if (String(input).endsWith("/api/v1/read/resource-graph")) {
        const body = await response.clone().json();
        reads.push({
          requestId: String((init?.headers as any)?.["x-request-id"] || ""),
          responseRequestId: response.headers.get("x-request-id"),
          schemaVersion: String(body.schemaVersion || ""),
          runtimeStatus: String(body.runtime?.status || ""),
        });
      }
      return response;
    },
  });
  vm.runInContext(CONTROL_PLANE_WEB_UI_JS, context);
  for (let i = 0; i < 40 && app.innerHTML === "Loading..."; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { html: app.innerHTML, reads };
}

async function captureStdout(fn: () => Promise<void>) {
  const lines: string[] = [];
  const original = console.log;
  console.log = (value?: unknown) => lines.push(String(value ?? ""));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

function assertHasNode(model: any, kind: string, name?: string) {
  assert.ok(
    model.nodes.some((node: any) => node.kind === kind && (!name || node.name === name)),
    `expected ${kind}${name ? ` ${name}` : ""}`,
  );
}

function nodeFor(model: any, kind: string, name: string) {
  return model.nodes.find((node: any) => node.kind === kind && node.name === name);
}

function assertSecretSafe(value: unknown) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /service-secret-token|raw-secret|Bearer|VBR_WORKER_OIDC_TOKEN|\/artifact-[ab]\b/,
  );
}
