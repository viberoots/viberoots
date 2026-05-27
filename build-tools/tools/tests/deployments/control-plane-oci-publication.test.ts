#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  assertControlPlaneImageDigestReference,
  controlPlaneImagePublicationPlan,
} from "../../deployments/control-plane-image-publication";
import { buildImageTarball } from "./control-plane-oci-image.helpers";

const DIGEST = `sha256:${"a".repeat(64)}`;
const execFileAsync = promisify(execFile);

test("control-plane image publication records immutable digest and source revision", () => {
  const plan = controlPlaneImagePublicationPlan({
    repository: "registry.example.com/platform/deployment-control-plane",
    sourceRevision: "source-abc123",
    digest: DIGEST,
    imageTarball: "/nix/store/image.tar.gz",
  });
  assert.equal(plan.tagRef, "registry.example.com/platform/deployment-control-plane:source-abc123");
  assert.equal(plan.digestRef, `registry.example.com/platform/deployment-control-plane@${DIGEST}`);
  assert.deepEqual(plan.manifest, {
    image: plan.digestRef,
    sourceRevision: "source-abc123",
    digest: DIGEST,
    tag: plan.tagRef,
  });
  assert.match(
    plan.commands.join("\n"),
    /skopeo copy docker-archive:'\/nix\/store\/image\.tar\.gz'/,
  );
  assert.match(plan.commands.join("\n"), /skopeo inspect/);
});

test("control-plane image publication rejects mutable production identity", () => {
  assert.equal(
    assertControlPlaneImageDigestReference(`registry.example.com/platform/control-plane@${DIGEST}`),
    `registry.example.com/platform/control-plane@${DIGEST}`,
  );
  assert.throws(
    () =>
      assertControlPlaneImageDigestReference("registry.example.com/platform/control-plane:latest"),
    /pinned by @sha256 digest/,
  );
  assert.throws(
    () => assertControlPlaneImageDigestReference("registry.example.com/platform/control-plane:tag"),
    /pinned by @sha256 digest/,
  );
});

test("control-plane image publication rejects tag or digest repositories", () => {
  assert.throws(
    () =>
      controlPlaneImagePublicationPlan({
        repository: "registry.example.com/platform/control-plane:latest",
        sourceRevision: "source-abc123",
        digest: DIGEST,
        imageTarball: "image.tar",
      }),
    /repository must not include a tag or digest/,
  );
  assert.throws(
    () =>
      controlPlaneImagePublicationPlan({
        repository: "registry.example.com/platform/control-plane",
        sourceRevision: "source-abc123",
        digest: "sha256:not-reviewed",
        imageTarball: "image.tar",
      }),
    /sha256:<64 lowercase hex>/,
  );
});

test("live-gated control-plane image publication pushes and verifies digest", async (t) => {
  if (process.env.VBR_CONTROL_PLANE_IMAGE_LIVE_REGISTRY !== "1") {
    t.skip("set VBR_CONTROL_PLANE_IMAGE_LIVE_REGISTRY=1 to push to a live registry");
    return;
  }
  const repository = String(process.env.VBR_CONTROL_PLANE_IMAGE_REPOSITORY || "").trim();
  const image = await buildImageTarball();
  const contractDigest = String(process.env.VBR_CONTROL_PLANE_IMAGE_EXPECTED_DIGEST || "").trim();
  const plan = controlPlaneImagePublicationPlan({
    repository,
    sourceRevision: image.repoTag.split(":").at(-1) || "source-live",
    digest: contractDigest,
    imageTarball: image.outPath,
  });
  await execFileAsync("skopeo", [
    "copy",
    `docker-archive:${image.outPath}`,
    `docker://${plan.tagRef}`,
  ]);
  const inspect = await execFileAsync("skopeo", [
    "inspect",
    "--format",
    "{{.Digest}}",
    `docker://${plan.tagRef}`,
  ]);
  assert.equal(inspect.stdout.trim(), plan.digest);
  const pullDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-cp-image-live-pull-"));
  t.after(() => fsp.rm(pullDir, { recursive: true, force: true }));
  await execFileAsync("skopeo", ["copy", `docker://${plan.digestRef}`, `dir:${pullDir}`]);
});
