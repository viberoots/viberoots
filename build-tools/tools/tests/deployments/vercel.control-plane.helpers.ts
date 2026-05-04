#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture.ts";
import { vercelDeploymentFixture } from "./vercel.fixture.ts";

export async function withVercelSmokeServer<T>(
  fn: (override: { protocol: "http:"; hostname: string; port: number }) => Promise<T>,
): Promise<T> {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url === "/login" ? "authkit route" : "<html>console</html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: (server.address() as any).port,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function writeVercelArtifact(root: string) {
  const output = path.join(root, ".vercel", "output");
  await fsp.mkdir(path.join(output, "functions", "render.func"), { recursive: true });
  await fsp.writeFile(path.join(output, "config.json"), '{"version":3}\n', "utf8");
  await fsp.writeFile(
    path.join(output, "functions", "render.func", ".vc-config.json"),
    "{}",
    "utf8",
  );
  return root;
}

export async function writeVercelPublisherConfig(tmp: string) {
  await fsp.mkdir(path.join(tmp, "projects", "deployments", "console-staging"), {
    recursive: true,
  });
  await fsp.writeFile(
    path.join(tmp, "projects", "deployments", "console-staging", "vercel-prebuilt.jsonc"),
    '{"mode":"prebuilt"}\n',
  );
}

export async function withVercelFixtureSecrets<T>(
  contracts: Record<string, { value: string; allowedSteps: string[]; targetScopes: string[] }>,
  fn: (tmp: string) => Promise<T>,
): Promise<T> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-cp-"));
  const previous = process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  const fixturePath = path.join(tmp, "secrets.json");
  await fsp.writeFile(
    fixturePath,
    JSON.stringify({ schemaVersion: "deployment-secret-fixture@1", contracts }),
  );
  process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = fixturePath;
  try {
    return await fn(tmp);
  } finally {
    if (previous === undefined) delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
    else process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = previous;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

export function deploymentWithVercelCleanupSecret() {
  return vercelDeploymentFixture({
    secretRequirements: [
      {
        name: "vercel_api_token",
        step: "preview_cleanup",
        contractId: "vercel/api-token",
        required: true,
      },
    ],
  });
}

export function deploymentWithVercelSecret() {
  return vercelDeploymentFixture({
    secretRequirements: [
      {
        name: "vercel_api_token",
        step: "publish",
        contractId: "vercel/api-token",
        required: true,
      },
      {
        name: "vercel_api_token",
        step: "smoke",
        contractId: "vercel/api-token",
        required: true,
      },
    ],
  });
}
