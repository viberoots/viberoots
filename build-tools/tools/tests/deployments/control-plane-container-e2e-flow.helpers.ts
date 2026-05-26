#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/s3-static-control-plane";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";
import { runControlPlaneContainer } from "./control-plane-container-smoke.helpers";
import {
  E2E_TOKEN,
  runFixtureContainer,
  writeFakeS3Server,
} from "./control-plane-container-e2e.helpers";

const CONFIG_PATH = "/etc/deployment-control-plane/config.yaml";

export async function startFixtures(
  runtime: any,
  network: string,
  names: any,
  imageTag: string,
  tmp: string,
) {
  await runFixtureContainer({
    runtime,
    name: names.postgres,
    image: "postgres:16-alpine",
    network,
    env: { POSTGRES_PASSWORD: "postgres", POSTGRES_DB: "postgres" },
  });
  await writeFakeS3Server(path.join(tmp, "fake-s3.mjs"));
  await runFixtureContainer({
    runtime,
    name: names.s3,
    image: imageTag,
    network,
    entrypoint: "node",
    command: ["/fixtures/fake-s3.mjs"],
    mounts: [`type=bind,source=${tmp},target=/fixtures,readonly`],
  });
}

export async function startControlPlaneService(
  runtime: any,
  network: string,
  names: any,
  image: any,
  mounts: any,
  workspace: string,
  port: number,
) {
  await runControlPlaneContainer({
    runtime,
    image,
    name: names.service,
    mounts,
    network,
    publishPort: port,
    env: { WORKSPACE_ROOT: "/workspace" },
    extraMounts: [`type=bind,source=${workspace},target=/workspace`],
    command: ["service", "--config", CONFIG_PATH],
  });
}

export async function startControlPlaneWorkers(
  runtime: any,
  network: string,
  names: any,
  image: any,
  mounts: any,
  workspace: string,
) {
  const common = {
    WORKSPACE_ROOT: "/workspace",
    VBR_S3_STATIC_AWS_BIN: "/workspace/bin/aws",
    VBR_S3_STATIC_FAKE_PUBLISH_ROOT: "/var/lib/deployment-control-plane/runtime/published",
    VBR_S3_STATIC_FAKE_AWS_LOG: "/var/lib/deployment-control-plane/runtime/aws.log",
  };
  for (const [index, name] of names.workers.entries()) {
    await runControlPlaneContainer({
      runtime,
      image,
      name,
      mounts,
      network,
      env: common,
      extraMounts: [`type=bind,source=${workspace},target=/workspace`],
      command: [
        "worker",
        "--config",
        CONFIG_PATH,
        "--worker-id",
        `e2e-worker-${index}`,
        "--poll-ms",
        "250",
      ],
    });
  }
}

export async function writeE2eConfig(configPath: string, port: number) {
  const text = await fsp.readFile(configPath, "utf8");
  await fsp.writeFile(
    configPath,
    text
      .replace(`port: ${port}`, `port: ${port}`)
      .replace(
        "pgmem://container-smoke-secret-database-url",
        "postgres://postgres:postgres@postgres:5432/postgres",
      )
      .replace("http://127.0.0.1:9", "http://s3:9000")
      .replace("webUi:\n  enabled: false", "webUi:\n  enabled: true")
      .replace("mcp:\n  enabled: false", "mcp:\n  enabled: true"),
    "utf8",
  );
}

export async function submit(port: number, artifactDir: string, submissionId: string) {
  const deployment = s3StaticDeploymentFixture({
    smoke: {
      exception: {
        owner: "platform",
        reason: "deterministic container fixture",
        scope: "omit container e2e smoke",
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
    },
  });
  return await postJson(port, "/api/v1/submissions", {
    schemaVersion: S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
    submissionId,
    submittedAt: "2026-05-15T12:00:00.000Z",
    deployment,
    operationKind: "deploy",
    artifactDir,
    admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
  });
}

export async function waitForFinished(port: number, submissionId: string) {
  for (let i = 0; i < 120; i++) {
    const status = await readJson(port, `/api/v1/status?submissionId=${submissionId}`);
    if (status.lifecycleState === "finished") return status;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("container E2E submission did not finish");
}

async function postJson(port: number, pathname: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${E2E_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, await response.text());
  return (await response.json()) as any;
}

export async function readJson(port: number, pathname: string) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: { authorization: `Bearer ${E2E_TOKEN}` },
  });
  assert.equal(response.status, 200, await response.text());
  return (await response.json()) as any;
}

export async function callMcp(port: number, name: string, args: Record<string, string>) {
  return await callMcpRaw(port, "tools/call", { name, arguments: args }, "container-e2e-mcp");
}

export async function callMcpRaw(port: number, method: string, params: any, id: string) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${E2E_TOKEN}`,
      "content-type": "application/json",
      "x-request-id": id,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert.equal(response.status, 200, await response.text());
  return (await response.json()) as any;
}

export async function renderUiRoute(
  port: number,
  route: string,
  requestId: string,
): Promise<string> {
  const session = await postJson(port, "/api/v1/web/session", {});
  const js = await (await fetch(`http://127.0.0.1:${port}/assets/control-plane.js`)).text();
  const app = { innerHTML: "Loading..." };
  const context = vm.createContext({
    window: {
      __CONTROL_PLANE_BASE_PATH__: "",
      crypto: {
        randomUUID: () => requestId,
      },
      localStorage: { getItem: () => session.sessionId },
    },
    location: {
      pathname: route.split("?")[0],
      search: route.includes("?") ? `?${route.split("?")[1]}` : "",
    },
    document: { getElementById: () => app },
    URLSearchParams,
    fetch: async (input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      return await fetch(new URL(input, `http://127.0.0.1:${port}`), { ...init, headers });
    },
  });
  vm.runInContext(js, context);
  for (let i = 0; i < 50 && app.innerHTML === "Loading..."; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return app.innerHTML;
}
