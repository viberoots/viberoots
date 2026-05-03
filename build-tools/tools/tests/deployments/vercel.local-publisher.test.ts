#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { publishVercelPrebuiltLocal } from "../../deployments/vercel-local-publisher.ts";
import { vercelDeploymentFixture } from "./vercel.fixture.ts";

test("local Vercel publisher records deterministic output from admitted artifact identity", () => {
  const deployment = vercelDeploymentFixture();
  const first = publishVercelPrebuiltLocal({
    deployment,
    artifactIdentity: "vercel-output:abc123",
  });
  const second = publishVercelPrebuiltLocal({
    deployment,
    artifactIdentity: "vercel-output:abc123",
  });
  assert.deepEqual(first, second);
  assert.equal(first.publicUrl, "https://console-staging.vercel.app/");
  assert.equal(first.artifactIdentity, "vercel-output:abc123");
  assert.equal(first.providerTargetIdentity, "vercel:web-platform/console-staging#staging");
});

test("local Vercel publisher requires an admitted artifact identity", () => {
  assert.throws(
    () =>
      publishVercelPrebuiltLocal({ deployment: vercelDeploymentFixture(), artifactIdentity: "" }),
    /requires an admitted artifact identity/,
  );
});
