#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";

export async function writeLifecycleArtifact(root: string, html: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

export async function writeLifecycleWranglerConfig(filePath: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

export async function withFakeCloudflareLifecycleApi<T>(
  cfToken: string,
  run: () => Promise<T>,
): Promise<T> {
  const projects = new Set<string>();
  const domains = new Set<string>();
  const dnsRecords = new Set<string>();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.headers.authorization !== `Bearer ${cfToken}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, errors: [{ message: "unauthorized" }] }));
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const project = decodeURIComponent(url.pathname.split("/pages/projects/")[1] || "");
      const domain = decodeURIComponent(url.pathname.split("/domains/")[1] || "");
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.method === "GET" && project && !project.includes("/")) {
        json(projects.has(project) ? 200 : 404, {
          success: projects.has(project),
          result: { name: project, production_branch: "main" },
          errors: projects.has(project) ? [] : [{ message: "Project not found" }],
        });
      } else if (req.method === "POST" && url.pathname.endsWith("/pages/projects")) {
        projects.add(String(JSON.parse(body).name || ""));
        json(200, { success: true, result: JSON.parse(body) });
      } else if (req.method === "GET" && domain) {
        json(domains.has(domain) ? 200 : 404, {
          success: domains.has(domain),
          result: { name: domain, status: "active" },
          errors: domains.has(domain) ? [] : [{ message: "not found" }],
        });
      } else if (req.method === "POST" && url.pathname.endsWith("/domains")) {
        domains.add(String(JSON.parse(body).name || ""));
        json(200, { success: true, result: { name: JSON.parse(body).name, status: "pending" } });
      } else if (req.method === "GET" && url.pathname.endsWith("/dns_records")) {
        const name = url.searchParams.get("name") || "";
        json(200, { success: true, result: dnsRecords.has(name) ? [{ id: "dns-1", name }] : [] });
      } else if (req.method === "POST" && url.pathname.endsWith("/dns_records")) {
        dnsRecords.add(String(JSON.parse(body).name || ""));
        json(200, { success: true, result: { id: "dns-1", ...JSON.parse(body) } });
      } else {
        json(500, { success: false, errors: [{ message: `unexpected ${url.pathname}` }] });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake Cloudflare API bind failed");
  const original = process.env.VBR_CLOUDFLARE_API_BASE_URL;
  process.env.VBR_CLOUDFLARE_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    return await run();
  } finally {
    if (original === undefined) delete process.env.VBR_CLOUDFLARE_API_BASE_URL;
    else process.env.VBR_CLOUDFLARE_API_BASE_URL = original;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
