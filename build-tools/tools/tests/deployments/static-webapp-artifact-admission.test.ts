#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  createStaticWebappArtifactBundleBytes,
  STATIC_WEBAPP_ARTIFACT_BUNDLE_SCHEMA,
} from "../../deployments/static-webapp-artifact-bundle.ts";
import {
  createStaticWebappUploadSession,
  admitStaticWebappUploadSession,
} from "../../deployments/static-webapp-upload-sessions.ts";
import { resolveCloudflarePagesArtifactInput } from "../../deployments/cloudflare-pages-artifact-input.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";

async function writeArtifact(root: string, body = "<html>ok</html>\n") {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), body, "utf8");
}

test("static-webapp client uploads are digested, stored, and provenance-recorded", async () => {
  await runInTemp("static-webapp-client-upload-admission", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir);
    const upload = await createStaticWebappUploadSession({
      recordsRoot,
      submissionId: "submission-1",
      archiveBytes: await createStaticWebappArtifactBundleBytes(artifactDir),
    });
    const admitted = await admitStaticWebappUploadSession({
      recordsRoot,
      uploadSessionId: upload.uploadSessionId,
      submissionId: "submission-1",
      deploymentLabel: "//projects/deployments/pleomino-staging:deploy",
      sourceRevision: "abc123",
      buildTarget: "//projects/apps/pleomino:app",
    });
    assert.equal(admitted.producerKind, "client_upload");
    assert.equal(admitted.storageReference, `upload-session:${upload.uploadSessionId}`);
    await fsp.access(path.join(admitted.storedArtifactPath, "index.html"));
    const provenance = JSON.parse(await fsp.readFile(admitted.provenancePath, "utf8"));
    assert.equal(provenance.producer.archiveDigest, upload.archiveDigest);
    assert.equal(provenance.producer.sourceRevision, "abc123");
  });
});

test("static-webapp bundles reject path traversal before storage", async () => {
  const unsafe = Buffer.from(
    JSON.stringify({
      schemaVersion: STATIC_WEBAPP_ARTIFACT_BUNDLE_SCHEMA,
      files: [{ path: "../escape.html", mode: "file", contentBase64: "b2sK" }],
    }),
  );
  await assert.rejects(
    async () =>
      await createStaticWebappUploadSession({
        recordsRoot: "/tmp/static-webapp-path-traversal",
        submissionId: "submission-unsafe",
        archiveBytes: unsafe,
      }),
    /unsafe path/,
  );
});

test("static-webapp upload sessions are bound to one submission", async () => {
  await runInTemp("static-webapp-upload-binding", async (tmp) => {
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir);
    const upload = await createStaticWebappUploadSession({
      recordsRoot: path.join(tmp, "records"),
      submissionId: "submission-a",
      archiveBytes: await createStaticWebappArtifactBundleBytes(artifactDir),
    });
    await assert.rejects(
      async () =>
        await admitStaticWebappUploadSession({
          recordsRoot: path.join(tmp, "records"),
          uploadSessionId: upload.uploadSessionId,
          submissionId: "submission-b",
          deploymentLabel: "//projects/deployments/pleomino-staging:deploy",
          sourceRevision: "abc123",
          buildTarget: "//projects/apps/pleomino:app",
        }),
      /not bound to this submission/,
    );
  });
});

test("cloudflare artifact input rejects dirty client uploads", async () => {
  await runInTemp("cloudflare-artifact-input-dirty", async (tmp) => {
    const deployment = cloudflarePagesDeploymentFixture();
    await assert.rejects(
      async () =>
        await resolveCloudflarePagesArtifactInput({
          workspaceRoot: tmp,
          recordsRoot: path.join(tmp, "records"),
          deployment,
          submissionId: "submission-dirty",
          artifactInput: {
            kind: "client_upload",
            uploadSessionId: "upload-dirty",
            sourceRevision: "HEAD",
            sourceDirty: true,
            deploymentLabel: deployment.label,
            buildTarget: deployment.component.target,
          },
        }),
      /clean reviewed source state/,
    );
  });
});
