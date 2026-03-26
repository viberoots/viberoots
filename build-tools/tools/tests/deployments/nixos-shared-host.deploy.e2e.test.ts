#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>pleomino</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("nixos-shared-host deploy CLI completes the shared-dev static-webapp flow end to end", async () => {
  await runInTemp("nixos-shared-host-e2e", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "pleomino", containerPort: 3000, healthPath: "/healthz" },
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    await writeArtifact(artifactDir);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      const result = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${path.join(tmp, "platform-state.json")} --records-root ${path.join(tmp, "records")} --host-config-out ${path.join(tmp, "rendered-host.json")} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.finalOutcome, "succeeded");
      assert.equal(summary.publicUrl, "https://pleomino.apps.kilty.io/");
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.artifactIdentity, summary.artifactIdentity);
      assert.equal(record.finalOutcome, "succeeded");
      const rendered = JSON.parse(await fsp.readFile(path.join(tmp, "rendered-host.json"), "utf8"));
      assert.ok(rendered.containers.pleomino);
    } finally {
      await server.close();
    }
  });
});
