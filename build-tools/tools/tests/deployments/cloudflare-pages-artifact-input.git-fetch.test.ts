#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveCloudflarePagesArtifactInput } from "../../deployments/cloudflare-pages-artifact-input.ts";
import { createStaticWebappArtifactBundleBytes } from "../../deployments/static-webapp-artifact-bundle.ts";
import { createStaticWebappUploadSession } from "../../deployments/static-webapp-upload-sessions.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";

async function writeArtifact(root: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>ok</html>\n", "utf8");
}

test("cloudflare artifact input fetches missing reviewed source revisions before rejecting", async () => {
  await runInTemp("cloudflare-artifact-input-fetch-source", async (tmp) => {
    const remoteRepo = path.join(tmp, "remote.git");
    const sourceRepo = path.join(tmp, "source");
    const serviceRepo = path.join(tmp, "service");
    await $({ cwd: tmp })`git init --bare ${remoteRepo}`;
    await fsp.mkdir(sourceRepo);
    await $({ cwd: sourceRepo })`git init`;
    await $({ cwd: sourceRepo })`git config user.email test@example.invalid`;
    await $({ cwd: sourceRepo })`git config user.name Test`;
    await fsp.writeFile(path.join(sourceRepo, "source.txt"), "one\n", "utf8");
    await $({ cwd: sourceRepo })`git add source.txt`;
    await $({ cwd: sourceRepo })`git commit -m initial`;
    await $({ cwd: sourceRepo })`git remote add origin ${remoteRepo}`;
    await $({ cwd: sourceRepo })`git push origin HEAD`;
    await $({ cwd: tmp })`git clone ${remoteRepo} ${serviceRepo}`;

    await fsp.writeFile(path.join(sourceRepo, "source.txt"), "two\n", "utf8");
    await $({ cwd: sourceRepo })`git commit -am second`;
    await $({ cwd: sourceRepo })`git push origin HEAD`;
    const revisionOut = await $({ cwd: sourceRepo, stdio: "pipe" })`git rev-parse HEAD`;
    const sourceRevision = String((revisionOut as any).stdout || "").trim();
    const verifyRevisionArgs = ["rev-parse", "--verify", `${sourceRevision}^{commit}`];
    const missingBeforeFetch = await $({
      cwd: serviceRepo,
      stdio: "pipe",
    })`git ${verifyRevisionArgs}`.nothrow();
    assert.notEqual((missingBeforeFetch as any).exitCode, 0);

    const recordsRoot = path.join(tmp, "records");
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir);
    const upload = await createStaticWebappUploadSession({
      recordsRoot,
      submissionId: "submission-fetch",
      archiveBytes: await createStaticWebappArtifactBundleBytes(artifactDir),
    });
    const deployment = cloudflarePagesDeploymentFixture();
    const admitted = await resolveCloudflarePagesArtifactInput({
      workspaceRoot: serviceRepo,
      recordsRoot,
      deployment,
      submissionId: "submission-fetch",
      artifactInput: {
        kind: "client_upload",
        uploadSessionId: upload.uploadSessionId,
        sourceRevision,
        deploymentLabel: deployment.label,
        buildTarget: deployment.component.target,
      },
    });

    assert.equal(admitted.producerKind, "client_upload");
    const serviceHasRevision = await $({
      cwd: serviceRepo,
      stdio: "pipe",
    })`git ${verifyRevisionArgs}`.nothrow();
    assert.equal((serviceHasRevision as any).exitCode, 0);
  });
});
