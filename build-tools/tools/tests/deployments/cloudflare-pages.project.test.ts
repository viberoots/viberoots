#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { ensureCloudflarePagesProject } from "../../deployments/cloudflare-pages-project";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";

async function withFakeCloudflareApi<T>(
  run: (opts: {
    requests: Array<{ body: string; method: string; pathname: string }>;
  }) => Promise<T>,
): Promise<T> {
  const requests: Array<{ body: string; method: string; pathname: string }> = [];
  const projects = new Map<string, { name: string; production_branch: string }>();
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      requests.push({ body, method: req.method || "GET", pathname: url.pathname });
      if (req.headers.authorization !== "Bearer cf-test-token") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, errors: [{ message: "unauthorized" }] }));
        return;
      }
      const getMatch = url.pathname.match(/\/pages\/projects\/([^/]+)$/);
      if (req.method === "GET" && getMatch?.[1]) {
        const project = projects.get(decodeURIComponent(getMatch[1]));
        res.writeHead(project ? 200 : 404, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            project
              ? { success: true, result: project }
              : { success: false, errors: [{ message: "Project not found" }] },
          ),
        );
        return;
      }
      if (req.method === "POST" && url.pathname.endsWith("/pages/projects")) {
        const parsed = JSON.parse(body) as { name: string; production_branch: string };
        projects.set(parsed.name, parsed);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: true, result: parsed }));
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, errors: [{ message: "unexpected request" }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("fake Cloudflare API did not bind");
  const originalBase = process.env.VBR_CLOUDFLARE_API_BASE_URL;
  process.env.VBR_CLOUDFLARE_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    return await run({ requests });
  } finally {
    if (originalBase === undefined) delete process.env.VBR_CLOUDFLARE_API_BASE_URL;
    else process.env.VBR_CLOUDFLARE_API_BASE_URL = originalBase;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("cloudflare-pages project provisioning creates missing project with stage branch", async () => {
  await withFakeCloudflareApi(async ({ requests }) => {
    const deployment = cloudflarePagesDeploymentFixture({
      providerTarget: {
        ...cloudflarePagesDeploymentFixture().providerTarget,
        accountId: "1b911846f80a89272c0dbaf44f5c810f",
        customDomain: "staging.pleomino.com",
      },
    });
    const created = await ensureCloudflarePagesProject({
      deployment,
      apiToken: "cf-test-token",
    });
    assert.deepEqual(created, {
      kind: "ready",
      project: "pleomino-staging-pages",
      created: true,
      productionBranch: "env/pleomino/staging",
    });
    const createBody = JSON.parse(
      requests.find((request) => request.method === "POST")?.body || "{}",
    );
    assert.equal(createBody.name, "pleomino-staging-pages");
    assert.equal(createBody.production_branch, "env/pleomino/staging");
  });
});

test("cloudflare-pages project provisioning is idempotent", async () => {
  await withFakeCloudflareApi(async ({ requests }) => {
    const deployment = cloudflarePagesDeploymentFixture({
      providerTarget: {
        ...cloudflarePagesDeploymentFixture().providerTarget,
        accountId: "1b911846f80a89272c0dbaf44f5c810f",
      },
    });
    await ensureCloudflarePagesProject({ deployment, apiToken: "cf-test-token" });
    const existing = await ensureCloudflarePagesProject({ deployment, apiToken: "cf-test-token" });
    assert.equal(existing.created, false);
    assert.equal(requests.filter((request) => request.method === "POST").length, 1);
  });
});
