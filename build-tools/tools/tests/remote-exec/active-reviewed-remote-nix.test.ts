#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  remoteNixChildEnvironment,
  remoteNixCommandArgs,
  validateReviewedRemoteNixAuthority,
  withActiveReviewedRemoteNix,
} from "../../remote-exec/active-reviewed-remote-nix";
import type { RemoteBuilderSmokeEvidence } from "../../remote-exec/nix-remote-builder-config";
import { remoteBuilderSmokeEvidence } from "./remote-builder-smoke-test-fixture";

const smoke = remoteBuilderSmokeEvidence as RemoteBuilderSmokeEvidence;
const options = {
  activeSmoke: smoke,
  remoteCiTools: `/nix/store/${"d".repeat(32)}-remote-ci-tools`,
  transportFile: "/run/remote-builder-transport.json",
  policy: "inherit_config" as const,
  expectedSystem: "x86_64-linux" as const,
  reviewedBuilders: smoke.authorities.registryStorePath,
};

test("reviewed remote Nix refuses smoke evidence not activated in this process", async () => {
  await assert.rejects(
    withActiveReviewedRemoteNix(options, async () => undefined),
    /requires active smoke evidence from this process/,
  );
});

test("reviewed remote Nix rejects mismatched registry, system, and policy before execution", async () => {
  await assert.rejects(
    validateReviewedRemoteNixAuthority({
      ...options,
      reviewedBuilders: `/nix/store/${"e".repeat(32)}-registry/registry.json`,
    }),
    /does not bind the exact registry/,
  );
  await assert.rejects(
    validateReviewedRemoteNixAuthority({ ...options, expectedSystem: "aarch64-linux" }),
    /system does not match/,
  );
  await assert.rejects(
    validateReviewedRemoteNixAuthority({ ...options, policy: "force_builders_file" }),
    /policy does not match/,
  );
});

test("reviewed remote Nix puts transport only in the child environment", () => {
  const parent = { PATH: "/nix/store/tools/bin", NIX_REMOTE: "daemon" };
  const uri = "ssh-ng://builder.example.com?ssh-key=/run/secret";
  const child = remoteNixChildEnvironment(parent, uri);
  const args = remoteNixCommandArgs(["build", "--no-link", "flake#artifact"]);
  assert.equal(parent.NIX_REMOTE, "daemon");
  assert.equal(child.NIX_REMOTE, uri);
  assert.equal(args[args.indexOf("builders") + 1], "");
  assert.doesNotMatch(args.join(" "), /ssh-ng|ssh-key/);
});
