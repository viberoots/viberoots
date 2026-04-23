#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { admitNixosSharedHostArtifact } from "../../deployments/nixos-shared-host-artifacts.ts";
import { stagedUploadCompleteMarkerPath } from "../../deployments/nixos-shared-host-staged-artifact.ts";

async function writeFinalizedArtifact(stagingRoot: string, name: string): Promise<string> {
  const artifactDir = path.join(stagingRoot, name);
  await fsp.mkdir(artifactDir, { recursive: true });
  await fsp.writeFile(path.join(artifactDir, "index.html"), "<html>ok</html>\n", "utf8");
  await fsp.chmod(path.join(artifactDir, "index.html"), 0o444);
  await fsp.chmod(artifactDir, 0o555);
  await fsp.writeFile(
    stagedUploadCompleteMarkerPath(artifactDir),
    JSON.stringify({ schemaVersion: "nixos-shared-host-staged-upload@1" }) + "\n",
    "utf8",
  );
  return artifactDir;
}

async function withTemp<T>(name: string, fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  try {
    return await fn(tmp);
  } finally {
    await makeWritable(tmp).catch(() => {});
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

async function makeWritable(root: string): Promise<void> {
  await fsp.chmod(root, 0o755).catch(() => {});
  for (const entry of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) await makeWritable(abs);
    else await fsp.chmod(abs, 0o644).catch(() => {});
  }
}

test("nixos shared-host admits only finalized immutable staged artifacts", async () => {
  await withTemp("nixos-staged-artifact-admission", async (tmp) => {
    const stagingRoot = path.join(tmp, "runtime", ".deploy-artifacts");
    const artifactDir = await writeFinalizedArtifact(stagingRoot, "deploy-1");
    const admitted = await admitNixosSharedHostArtifact({
      recordsRoot: path.join(tmp, "records"),
      artifactDir,
      stagingRoot,
      kind: "static-webapp",
    });
    await fsp.access(path.join(admitted.storedArtifactPath, "index.html"));
    await assert.rejects(
      fsp.access(path.join(admitted.storedArtifactPath, "deploy-1.complete.json")),
    );
  });
});

test("nixos shared-host staged admission rejects mutable or escaping paths", async () => {
  await withTemp("nixos-staged-artifact-rejects", async (tmp) => {
    const stagingRoot = path.join(tmp, "runtime", ".deploy-artifacts");
    await fsp.mkdir(stagingRoot, { recursive: true });
    const outside = await writeFinalizedArtifact(path.join(tmp, "outside"), "artifact");
    await assert.rejects(
      () =>
        admitNixosSharedHostArtifact({
          recordsRoot: path.join(tmp, "records"),
          artifactDir: outside,
          stagingRoot,
          kind: "static-webapp",
        }),
      /configured staging root/,
    );
    const missingMarker = path.join(stagingRoot, "missing-marker");
    await fsp.mkdir(missingMarker, { recursive: true });
    await fsp.writeFile(path.join(missingMarker, "index.html"), "ok\n", "utf8");
    await fsp.chmod(missingMarker, 0o555);
    await assert.rejects(
      () =>
        admitNixosSharedHostArtifact({
          recordsRoot: path.join(tmp, "records"),
          artifactDir: missingMarker,
          stagingRoot,
          kind: "static-webapp",
        }),
      /completion marker/,
    );
    const writable = await writeFinalizedArtifact(stagingRoot, "writable");
    await fsp.chmod(path.join(writable, "index.html"), 0o644);
    await assert.rejects(
      () =>
        admitNixosSharedHostArtifact({
          recordsRoot: path.join(tmp, "records"),
          artifactDir: writable,
          stagingRoot,
          kind: "static-webapp",
        }),
      /writable entry/,
    );
  });
});
