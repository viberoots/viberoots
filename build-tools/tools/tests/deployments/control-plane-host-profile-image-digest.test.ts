#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { assertControlPlaneImageDigestReference } from "../../deployments/control-plane-image-publication";
import { REVIEWED_IMAGE_DIGEST } from "./control-plane-nixos-container-module.helpers";

const PROFILE_DIR = "build-tools/tools/deployments/control-plane-host-profile";
const COMPOSE_IMAGE_REF =
  "${VBR_CONTROL_PLANE_IMAGE_REGISTRY:?set image registry}/${VBR_CONTROL_PLANE_IMAGE_REPOSITORY:?set image repository}@${VBR_CONTROL_PLANE_IMAGE_DIGEST:?set immutable sha256 image digest}";

test("non-NixOS host profile requires digest-assembled image references", async () => {
  const compose = YAML.parse(await readProfileFile("compose.yaml")) as {
    services: Record<string, { image?: string }>;
  };
  for (const service of Object.values(compose.services)) {
    assert.equal(service.image, COMPOSE_IMAGE_REF);
    assert.doesNotMatch(service.image || "", /VBR_CONTROL_PLANE_IMAGE[:?}]/);
    assert.match(service.image || "", /@.*VBR_CONTROL_PLANE_IMAGE_DIGEST/);
  }
  const resolved = `registry.example.com/platform/deployment-control-plane@${REVIEWED_IMAGE_DIGEST}`;
  assert.equal(assertControlPlaneImageDigestReference(resolved), resolved);
  assert.throws(
    () =>
      assertControlPlaneImageDigestReference("registry.example.com/platform/control-plane:latest"),
    /pinned by @sha256 digest/,
  );
});

async function readProfileFile(name: string): Promise<string> {
  return await fsp.readFile(path.join(process.cwd(), PROFILE_DIR, name), "utf8");
}
