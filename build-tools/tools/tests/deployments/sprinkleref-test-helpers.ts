#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export async function writeSprinkleRefConfig(config: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-infisical-"));
  const file = path.join(dir, "config.json");
  await fs.writeFile(file, `${JSON.stringify({ version: 1, ...config }, null, 2)}\n`);
  return file;
}

export async function fakeRepoBootstrapFetch(input: string | URL | Request) {
  const url = new URL(String(input));
  if (url.pathname === "/api/v1/organization") {
    return jsonResponse({ organizations: [{ id: "org_1", name: "viberoots" }] });
  }
  if (url.pathname === "/api/v1/workspace") {
    return jsonResponse({ workspaces: [{ id: "proj_repo_test", name: "viberoots-deployments" }] });
  }
  if (url.pathname === "/v1/sys/mounts") return jsonResponse({ "secret/": { type: "kv" } });
  return jsonResponse({ error: `unexpected fake fetch path ${url.pathname}` }, 404);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
