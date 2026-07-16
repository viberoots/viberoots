#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stageSeedWithInheritedProtection } from "../../dev/verify/seed-pins";

test("nested seed staging protects inherited ownership until its sweep completes", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "seed-inherited-pin-"));
  const inheritedPinDir = path.join(root, "outer-pin");
  const inheritedSeed = path.join(root, "outer-seed");
  const events: string[] = [];
  await fsp.mkdir(inheritedPinDir);
  await fsp.mkdir(inheritedSeed);
  await fsp.symlink(inheritedSeed, path.join(inheritedPinDir, "seed"));
  try {
    const staged = await stageSeedWithInheritedProtection(
      {
        seedPath: "/nix/store/example-seed",
        seedKey: "nested-key",
        seedTtlMs: 60_000,
        workspaceRoot: root,
        iso: "nested",
        inheritedPinDir,
      },
      {
        createSharedPin: async (seedPath, iso) => {
          assert.equal(seedPath, inheritedSeed);
          assert.equal(iso, "nested-inherited");
          events.push("protect");
          return path.join(root, "shared-pin");
        },
        stage: async (_seedPath, _seedKey, _ttl, opts) => {
          assert.deepEqual(opts, { workspaceRoot: root, sharedPinIso: "nested" });
          events.push("stage");
          return path.join(root, "nested-seed");
        },
        remove: async () => {
          events.push("release");
        },
      },
    );
    assert.equal(staged, path.join(root, "nested-seed"));
    assert.deepEqual(events, ["protect", "stage", "release"]);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
