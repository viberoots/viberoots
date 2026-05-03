#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { admitKubernetesComponentArtifacts } from "../../deployments/kubernetes-artifacts.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { writeImageDigest, writeServiceArtifact } from "./kubernetes.service-artifact.fixture.ts";

test("kubernetes admits reviewed node service artifacts and image digests", async () => {
  await runInTemp("kubernetes-artifact-admission", async (tmp) => {
    const serviceArtifact = path.join(tmp, "service-artifact");
    const imageDigest = path.join(tmp, "image.digest");
    const serviceIdentity = await writeServiceArtifact(serviceArtifact, "api\n");
    const imageIdentity = await writeImageDigest(imageDigest);
    const artifacts = await admitKubernetesComponentArtifacts({
      recordsRoot: path.join(tmp, "records"),
      artifactPathsByComponentId: {
        api: serviceArtifact,
        worker: imageDigest,
      },
    });
    assert.deepEqual(
      artifacts.map((artifact) => [artifact.componentId, artifact.identity, artifact.sourceKind]),
      [
        ["api", serviceIdentity, "directory"],
        ["worker", imageIdentity, "image-digest"],
      ],
    );
  });
});

test("kubernetes rejects missing or unreviewed service artifacts", async () => {
  await runInTemp("kubernetes-artifact-rejects", async (tmp) => {
    const invalid = path.join(tmp, "invalid");
    await fsp.mkdir(invalid, { recursive: true });
    await fsp.writeFile(path.join(invalid, "service.txt"), "not reviewed\n", "utf8");
    await assert.rejects(
      admitKubernetesComponentArtifacts({
        recordsRoot: path.join(tmp, "records"),
        artifactPathsByComponentId: { api: path.join(tmp, "missing") },
      }),
      /missing service artifact/,
    );
    await assert.rejects(
      admitKubernetesComponentArtifacts({
        recordsRoot: path.join(tmp, "records"),
        artifactPathsByComponentId: { api: invalid },
      }),
      /runtime-contract\.json|reviewed node-service artifact identity/,
    );
  });
});
