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
import { buildImageContract, buildImageTarball } from "./control-plane-oci-image.helpers";

const DIGEST = `sha256:${"a".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"b".repeat(64)}`;
const execFileAsync = promisify(execFile);

test("control-plane image publication records immutable digest and source revision", () => {
  const plan = controlPlaneImagePublicationPlan({
    repository: "registry.example.com/platform/deployment-control-plane",
    sourceRevision: "source-abc123",
    imageBuildIdentity: BUILD_IDENTITY,
    digest: DIGEST,
    inspectedDigest: DIGEST,
    imageTarball: "/nix/store/image.tar.gz",
  });
  assert.equal(plan.tagRef, "registry.example.com/platform/deployment-control-plane:source-abc123");
  assert.equal(plan.digestRef, `registry.example.com/platform/deployment-control-plane@${DIGEST}`);
  assert.deepEqual(plan.manifest, {
    image: plan.digestRef,
    sourceRevision: "source-abc123",
    imageBuildIdentity: BUILD_IDENTITY,
    digest: DIGEST,
    inspectedDigest: DIGEST,
    tag: plan.tagRef,
    digestContract: {
      schemaVersion: "control-plane-image-digest-contract@1",
      build: {
        sourceRevision: "source-abc123",
        imageBuildIdentity: BUILD_IDENTITY,
      },
      publication: {
        status: "verified-registry-publication",
        productionUsable: true,
        image: plan.digestRef,
        digest: DIGEST,
        inspectedDigest: DIGEST,
        tag: plan.tagRef,
      },
    },
  });
  assert.match(
    plan.commands.join("\n"),
    /skopeo copy docker-archive:'\/nix\/store\/image\.tar\.gz'/,
  );
  assert.match(plan.commands.join("\n"), /skopeo inspect/);
});

test("control-plane image publication records build identity and registry digest relationship", () => {
  const plan = controlPlaneImagePublicationPlan({
    repository: "registry.example.com/platform/deployment-control-plane",
    sourceRevision: "source-abc123",
    imageBuildIdentity: BUILD_IDENTITY,
    digest: DIGEST,
    inspectedDigest: DIGEST,
    imageTarball: "/nix/store/image.tar.gz",
  });
  assert.equal(plan.manifest.imageBuildIdentity, BUILD_IDENTITY);
  assert.equal(plan.manifest.digest, DIGEST);
  assert.equal(plan.manifest.inspectedDigest, DIGEST);
  assert.equal(plan.manifest.digestContract.publication.status, "verified-registry-publication");
});

test("control-plane image publication rejects synthetic or unverified digest evidence", () => {
  assert.throws(
    () =>
      controlPlaneImagePublicationPlan({
        repository: "registry.example.com/platform/deployment-control-plane",
        sourceRevision: "source-abc123",
        imageBuildIdentity: DIGEST,
        digest: DIGEST,
        inspectedDigest: DIGEST,
        imageTarball: "/nix/store/image.tar.gz",
      }),
    /must not masquerade as a verified OCI digest/,
  );
  assert.throws(
    () =>
      controlPlaneImagePublicationPlan({
        repository: "registry.example.com/platform/deployment-control-plane",
        sourceRevision: "source-abc123",
        imageBuildIdentity: BUILD_IDENTITY,
        digest: DIGEST,
        inspectedDigest: `sha256:${"c".repeat(64)}`,
        imageTarball: "/nix/store/image.tar.gz",
      }),
    /must match registry inspect evidence/,
  );
  assert.throws(
    () =>
      controlPlaneImagePublicationPlan({
        repository: "registry.example.com/platform/deployment-control-plane",
        sourceRevision: "source-abc123",
        imageBuildIdentity: BUILD_IDENTITY,
        digest: "unpublished",
        inspectedDigest: DIGEST,
        imageTarball: "/nix/store/image.tar.gz",
      }),
    /verified digest|sha256:<64 lowercase hex>/,
  );
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
        imageBuildIdentity: BUILD_IDENTITY,
        digest: DIGEST,
        inspectedDigest: DIGEST,
        imageTarball: "image.tar",
      }),
    /repository must not include a tag or digest/,
  );
  assert.throws(
    () =>
      controlPlaneImagePublicationPlan({
        repository: "registry.example.com/platform/control-plane",
        sourceRevision: "source-abc123",
        imageBuildIdentity: BUILD_IDENTITY,
        digest: "sha256:not-reviewed",
        inspectedDigest: DIGEST,
        imageTarball: "image.tar",
      }),
    /sha256:<64 lowercase hex>/,
  );
});

test("live-gated control-plane image digest verification records inspect evidence", async (t) => {
  if (process.env.VBR_CONTROL_PLANE_IMAGE_LIVE_DIGEST_VERIFY !== "1") {
    t.skip("set VBR_CONTROL_PLANE_IMAGE_LIVE_DIGEST_VERIFY=1 to push to a live registry");
    return;
  }
  const repository = String(process.env.VBR_CONTROL_PLANE_IMAGE_REPOSITORY || "").trim();
  const image = await buildImageTarball();
  const contract = await buildImageContract();
  const tag = image.repoTag.split(":").at(-1) || "source-live";
  const tagRef = `${repository}:${tag}`;
  await execFileAsync("skopeo", ["copy", `docker-archive:${image.outPath}`, `docker://${tagRef}`]);
  const inspect = await execFileAsync("skopeo", [
    "inspect",
    "--format",
    "{{.Digest}}",
    `docker://${tagRef}`,
  ]);
  const inspectedDigest = inspect.stdout.trim();
  const plan = controlPlaneImagePublicationPlan({
    repository,
    sourceRevision: tag,
    imageBuildIdentity: contract.contract.imageBuildIdentity,
    digest: inspectedDigest,
    inspectedDigest,
    imageTarball: image.outPath,
  });
  assert.equal(inspect.stdout.trim(), plan.digest);
  const pullDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-cp-image-live-pull-"));
  t.after(() => fsp.rm(pullDir, { recursive: true, force: true }));
  await execFileAsync("skopeo", ["copy", `docker://${plan.digestRef}`, `dir:${pullDir}`]);
});
