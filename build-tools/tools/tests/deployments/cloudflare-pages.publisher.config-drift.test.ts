#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitCloudflarePagesControlPlaneDeploy } from "../../deployments/cloudflare-pages-control-plane.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>drift</html>\n", "utf8");
}

test("cloudflare-pages rejects wrangler config drift before publish begins", async () => {
  await runInTemp("cloudflare-pages-config-drift", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const configPath = path.join(
      tmp,
      "projects",
      "deployments",
      "pleomino-staging",
      "wrangler.jsonc",
    );
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(
      configPath,
      '{\n  "name": "pleomino-prod-pages",\n  "compatibility_date": "2026-03-18"\n}\n',
      "utf8",
    );
    await assert.rejects(
      async () =>
        await submitCloudflarePagesControlPlaneDeploy({
          workspaceRoot: tmp,
          deployment,
          artifactDir,
          recordsRoot: path.join(tmp, "records"),
        }),
      /does not match deployment provider_target\.project/,
    );
  });
});
