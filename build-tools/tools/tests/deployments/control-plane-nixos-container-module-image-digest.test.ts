#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { evalModule } from "./control-plane-nixos-container-module.helpers";

test("control-plane NixOS container module rejects tag-only image references", async () => {
  await runInTemp("control-plane-nixos-container-image-digest", async (tmp, $) => {
    const out = await evalModule(
      tmp,
      $,
      `image = "registry.example.com/platform/deployment-control-plane:latest";`,
      `{
      failedAssertions = map (item: item.message) (
        builtins.filter
          (item: !item.assertion && lib.hasPrefix "deploymentControlPlaneContainer" item.message)
          system.config.assertions
      );
    }`,
      { image: false },
    );
    assert.ok(
      (out.failedAssertions as string[]).includes(
        "deploymentControlPlaneContainer image must be pinned by @sha256:<64 lowercase hex>.",
      ),
    );
  });
});
