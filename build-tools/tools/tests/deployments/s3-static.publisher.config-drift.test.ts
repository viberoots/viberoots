#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitS3StaticDeploy } from "../../deployments/s3-static-deploy.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import { s3StaticDeploymentFixture } from "./s3-static.fixture.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>drift</html>\n", "utf8");
}

test("s3-static rejects provider config drift before publish begins", async () => {
  await runInTemp("s3-static-config-drift", async (tmp, $) => {
    const deployment = s3StaticDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-s3-config-drift-1",
      artifactIdentity: "artifact-s3-config-drift-1",
      artifactLineageId: "artifact-s3-config-drift-1",
    });
    const configPath = path.join(
      tmp,
      "projects",
      "deployments",
      "pleomino-staging-s3",
      "aws-s3-sync.jsonc",
    );
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(
      configPath,
      '{\n  "bucket": "pleomino-prod-site",\n  "region": "us-west-2"\n}\n',
      "utf8",
    );
    await assert.rejects(
      async () =>
        await submitS3StaticDeploy({
          workspaceRoot: tmp,
          deployment,
          artifactDir,
          recordsRoot: path.join(tmp, "records"),
          admissionEvidence,
        }),
      /does not match deployment provider_target\.bucket/,
    );
  });
});
