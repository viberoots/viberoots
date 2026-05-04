#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitCloudflarePagesControlPlaneDeploy } from "../../deployments/cloudflare-pages-control-plane";
import { runInTemp } from "../lib/test-helpers";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";

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
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-cloudflare-config-drift-1",
      artifactIdentity: "artifact-cloudflare-config-drift-1",
      artifactLineageId: "artifact-cloudflare-config-drift-1",
    });
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
          admissionEvidence,
        }),
      /does not match deployment provider_target\.project/,
    );
  });
});

test("cloudflare-pages rejects wrangler account_id drift before omitting it for Pages", async () => {
  await runInTemp("cloudflare-pages-account-id-drift", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    deployment.providerTarget.accountId = "1b911846f80a89272c0dbaf44f5c810f";
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-cloudflare-account-drift-1",
      artifactIdentity: "artifact-cloudflare-account-drift-1",
      artifactLineageId: "artifact-cloudflare-account-drift-1",
    });
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
      '{\n  "account_id": "00000000000000000000000000000000",\n  "compatibility_date": "2026-03-18"\n}\n',
      "utf8",
    );
    await assert.rejects(
      async () =>
        await submitCloudflarePagesControlPlaneDeploy({
          workspaceRoot: tmp,
          deployment,
          artifactDir,
          recordsRoot: path.join(tmp, "records"),
          admissionEvidence,
        }),
      /does not match deployment provider_target\.account/,
    );
  });
});
