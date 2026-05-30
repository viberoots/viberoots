#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { exec } from "node:child_process";
import * as fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { runInScratchTemp } from "../lib/test-helpers";

const sh = promisify(exec);
const DIGEST = `sha256:${"e".repeat(64)}`;
const IMAGE = `registry.example.com/platform/deployment-control-plane@${DIGEST}`;
const BUILD_IDENTITY = `nix-source-${"f".repeat(64)}`;

test("HTTP runbook commands write outputs from repo root and bundle root", async () => {
  await runInScratchTemp("cloud-control-http-runbook", async (tmp) => {
    const server = await startServer();
    try {
      const bundle = renderCloudControlSetupBundle(input(tmp, server.url));
      await writeBundle(tmp, bundle.files);
      const commands = JSON.parse(bundle.files["commands.json"]!);
      const credentials = path.join(tmp, "credentials");
      await fsp.mkdir(credentials);
      await fsp.writeFile(path.join(credentials, "control-plane-token"), "token-123\n");
      for (const cwd of [process.cwd(), tmp]) {
        await clearHttpOutputs(tmp);
        for (const id of ["health", "readiness", "worker-heartbeats"]) {
          await sh(runbookCommand(commands, id).command, {
            cwd,
            env: { ...process.env, CREDENTIAL_DIR: credentials },
          });
        }
        for (const output of [
          "http-health.json",
          "http-readiness.json",
          "http-worker-heartbeats.json",
        ]) {
          assert.equal(await exists(path.join(tmp, output)), true, `${output} written from ${cwd}`);
        }
      }
      assert.ok(server.authorizedHeartbeat);
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });
});

test("guide command flow stays in generated runbook phase order", async () => {
  const guide = await fsp.readFile("docs/control-plane-guide.md", "utf8");
  const commands = JSON.parse(
    renderCloudControlSetupBundle(input("unused", "https://deploy.example.test")).files[
      "commands.json"
    ]!,
  );
  const guideAnchors: Record<string, string> = {
    "local-review": "deployment-control-plane setup-doctor \\",
    "credential-preflight": "deployment-control-plane credential-preflight \\",
    "managed-dependencies": "## Step 8: Run Managed Dependency Validation",
    "process-start": "## Step 9: Start Service And Workers",
    "http-validation": "## Step 10: Run Runtime And AWS Evidence Checks",
  };
  const guidePositions = commands.phases.map((phase: { id: string }) =>
    guide.indexOf(guideAnchors[phase.id]!),
  );
  assert.ok(guidePositions.every((position: number) => position >= 0));
  assert.deepEqual(
    [...guidePositions].sort((a, b) => a - b),
    guidePositions,
  );
});

function input(outDir: string, publicUrl: string): CloudControlSetupInput {
  return {
    outDir,
    mode: "aws-ec2",
    image: IMAGE,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: IMAGE,
      sourceRevision: "source-review",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-review",
    },
    instanceId: "cloud-review",
    publicUrl,
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    supabasePrivatelink: true,
    awsVpcEndpoint: true,
    awsSubnetIds: ["subnet-123"],
    awsSecurityGroupIds: ["sg-123"],
    tlsEvidence: "alb-listener-dns-reviewed",
  };
}

async function startServer() {
  const state = { authorizedHeartbeat: false, url: "", close: (_done: () => void) => {} };
  const server = http.createServer((req, res) => {
    if (req.url === "/api/v1/worker-heartbeats") {
      state.authorizedHeartbeat = req.headers.authorization === "Bearer token-123";
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  state.url = `http://127.0.0.1:${address.port}`;
  state.close = (done) => server.close(done);
  return state;
}

async function writeBundle(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fsp.writeFile(path.join(dir, name), content, "utf8");
  }
}

async function clearHttpOutputs(dir: string): Promise<void> {
  await Promise.all(
    ["http-health.json", "http-readiness.json", "http-worker-heartbeats.json"].map((name) =>
      fsp.rm(path.join(dir, name), { force: true }),
    ),
  );
}

async function exists(file: string): Promise<boolean> {
  return fsp.access(file).then(
    () => true,
    () => false,
  );
}

function runbookCommand(commands: any, id: string) {
  const found = commands.phases
    .flatMap((phase: any) => phase.commands)
    .find((command: any) => command.id === id);
  if (!found) throw new Error(`missing runbook command ${id}`);
  return found;
}
