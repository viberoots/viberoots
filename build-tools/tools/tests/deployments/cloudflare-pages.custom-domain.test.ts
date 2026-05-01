#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { ensureCloudflarePagesCustomDomain } from "../../deployments/cloudflare-pages-custom-domain.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";

async function withFakeCloudflareApi<T>(
  run: (opts: {
    url: string;
    requests: Array<{ method: string; pathname: string; search: string }>;
  }) => Promise<T>,
  options: { dnsRecordAuthFailure?: boolean } = {},
): Promise<T> {
  const requests: Array<{ method: string; pathname: string; search: string }> = [];
  const domains = new Set<string>();
  const dnsRecords = new Map<string, { id: string; content: string; proxied: boolean }>();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    requests.push({ method: req.method || "GET", pathname: url.pathname, search: url.search });
    if (req.headers.authorization !== "Bearer cf-test-token") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, errors: [{ message: "unauthorized" }] }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/zones") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          result:
            url.searchParams.get("name") === "pleomino.com" && !url.searchParams.has("account.id")
              ? [{ id: "zone-pleomino", name: "pleomino.com" }]
              : [],
        }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname.endsWith("/dns_records")) {
      if (options.dnsRecordAuthFailure) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            errors: [{ code: 10000, message: "Authentication error" }],
          }),
        );
        return;
      }
      const name = url.searchParams.get("name") || "";
      const record = dnsRecords.get(name);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          result: record ? [{ id: record.id, type: "CNAME", name, ...record }] : [],
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/dns_records")) {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body) as { name: string; content: string; proxied: boolean };
        dnsRecords.set(parsed.name, {
          id: "dns-record-1",
          content: parsed.content,
          proxied: parsed.proxied,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: true, result: { id: "dns-record-1", ...parsed } }));
      });
      return;
    }
    const domainMatch = url.pathname.match(/\/domains\/([^/]+)$/);
    if (req.method === "GET" && domainMatch?.[1]) {
      const domain = decodeURIComponent(domainMatch[1]);
      if (!domains.has(domain)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, errors: [{ message: "not found" }] }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true, result: { name: domain, status: "active" } }));
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/domains")) {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const name = String(JSON.parse(body).name || "");
        domains.add(name);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: true, result: { name, status: "pending" } }));
      });
      return;
    }
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: false, errors: [{ message: "unexpected request" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("fake Cloudflare API did not bind");
  const originalBase = process.env.BNX_CLOUDFLARE_API_BASE_URL;
  process.env.BNX_CLOUDFLARE_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    return await run({ url: process.env.BNX_CLOUDFLARE_API_BASE_URL, requests });
  } finally {
    if (originalBase === undefined) delete process.env.BNX_CLOUDFLARE_API_BASE_URL;
    else process.env.BNX_CLOUDFLARE_API_BASE_URL = originalBase;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("cloudflare-pages custom domain provisioning creates missing domains idempotently", async () => {
  await withFakeCloudflareApi(async ({ requests }) => {
    const deployment = cloudflarePagesDeploymentFixture({
      providerTarget: {
        ...cloudflarePagesDeploymentFixture().providerTarget,
        accountId: "1b911846f80a89272c0dbaf44f5c810f",
        customDomain: "staging.pleomino.com",
      },
    });
    const created = await ensureCloudflarePagesCustomDomain({
      deployment,
      apiToken: "cf-test-token",
    });
    assert.deepEqual(created, {
      kind: "ready",
      domain: "staging.pleomino.com",
      created: true,
      status: "pending",
    });
    const existing = await ensureCloudflarePagesCustomDomain({
      deployment,
      apiToken: "cf-test-token",
    });
    assert.deepEqual(existing, {
      kind: "ready",
      domain: "staging.pleomino.com",
      created: false,
      status: "active",
    });
    assert.equal(
      requests.filter(
        (request) => request.method === "POST" && request.pathname.endsWith("/domains"),
      ).length,
      1,
    );
    assert.equal(
      requests.filter(
        (request) => request.method === "POST" && request.pathname.endsWith("/dns_records"),
      ).length,
      1,
    );
    assert.equal(requests.filter((request) => request.pathname === "/zones").length, 4);
    assert.equal(
      requests.some(
        (request) => request.pathname === "/zones" && request.search.includes("account.id"),
      ),
      false,
    );
    assert.equal(
      requests.filter(
        (request) => request.method === "GET" && request.pathname.endsWith("/dns_records"),
      ).length,
      2,
    );
  });
});

test("cloudflare-pages custom domain provisioning explains DNS token scope failures", async () => {
  await assert.rejects(
    () =>
      withFakeCloudflareApi(
        async () => {
          const deployment = cloudflarePagesDeploymentFixture({
            providerTarget: {
              ...cloudflarePagesDeploymentFixture().providerTarget,
              accountId: "1b911846f80a89272c0dbaf44f5c810f",
              customDomain: "staging.pleomino.com",
              customDomainZoneId: "zone-pleomino",
            },
          });
          await ensureCloudflarePagesCustomDomain({
            deployment,
            apiToken: "cf-test-token",
          });
        },
        { dnsRecordAuthFailure: true },
      ),
    /Zone:DNS Read and Zone:DNS Edit scoped to zone zone-pleomino for staging\.pleomino\.com/,
  );
});

test("cloudflare-pages custom domain provisioning can use a configured DNS zone id", async () => {
  await withFakeCloudflareApi(async ({ requests }) => {
    const deployment = cloudflarePagesDeploymentFixture({
      providerTarget: {
        ...cloudflarePagesDeploymentFixture().providerTarget,
        accountId: "1b911846f80a89272c0dbaf44f5c810f",
        customDomain: "staging.pleomino.com",
        customDomainZoneId: "zone-pleomino",
      },
    });
    const created = await ensureCloudflarePagesCustomDomain({
      deployment,
      apiToken: "cf-test-token",
    });
    assert.deepEqual(created, {
      kind: "ready",
      domain: "staging.pleomino.com",
      created: true,
      status: "pending",
    });
    assert.equal(requests.filter((request) => request.pathname === "/zones").length, 0);
    assert.equal(
      requests.filter((request) => request.pathname === "/zones/zone-pleomino/dns_records").length,
      2,
    );
  });
});
