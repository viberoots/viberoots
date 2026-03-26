#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runNixosSharedHostStaticDeploy } from "../../deployments/nixos-shared-host-static-deploy.ts";
import { runInTemp } from "../lib/test-helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, body, "utf8");
  }
}

test("nixos-shared-host deploy records smoke failure when the public health path fails", async () => {
  await runInTemp("nixos-shared-host-smoke-failure", async (tmp) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "pleomino", containerPort: 3000, healthPath: "/healthz" },
    });
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(artifactDir, { "index.html": "<html>ok</html>\n" });
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      await assert.rejects(
        runNixosSharedHostStaticDeploy({
          deployment,
          artifactDir,
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot,
          recordsRoot,
          smokeConnectOverride: {
            protocol: "https:",
            hostname: "127.0.0.1",
            port: server.port,
            rejectUnauthorized: false,
          },
        }),
        (error: any) => {
          assert.equal(error.record.finalOutcome, "failed");
          assert.match(error.record.error, /expected 200/);
          return true;
        },
      );
      const runsDir = path.join(recordsRoot, "runs");
      const [recordName] = await fsp.readdir(runsDir);
      const record = JSON.parse(await fsp.readFile(path.join(runsDir, recordName), "utf8"));
      assert.equal(record.finalOutcome, "failed");
    } finally {
      await server.close();
    }
  });
});

test("nixos-shared-host deploy rejects a reachable hostname serving the wrong artifact contents", async () => {
  await runInTemp("nixos-shared-host-content-mismatch", async (tmp) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const fixedRoot = path.join(tmp, "wrong-public-root");
    await writeArtifact(artifactDir, { "index.html": "<html>expected</html>\n" });
    await writeArtifact(fixedRoot, { "index.html": "<html>wrong</html>\n" });
    const server = await startNixosSharedHostPublicServer({ deployment, fixedRoot });
    try {
      await assert.rejects(
        runNixosSharedHostStaticDeploy({
          deployment,
          artifactDir,
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot: path.join(tmp, "host"),
          recordsRoot: path.join(tmp, "records"),
          smokeConnectOverride: {
            protocol: "https:",
            hostname: "127.0.0.1",
            port: server.port,
            rejectUnauthorized: false,
          },
        }),
        /smoke content mismatch/,
      );
    } finally {
      await server.close();
    }
  });
});
