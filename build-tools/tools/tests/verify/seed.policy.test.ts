#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { shouldPrepareVerifySeedForRequestedTargets } from "../../dev/verify/seed";
import { seedStageRootDirForTest, stageSeedStore } from "../../dev/verify/seed-staging";
import { mktemp } from "../lib/test-helpers";

test("verify seed build policy defaults to full-suite only", () => {
  assert.equal(shouldPrepareVerifySeedForRequestedTargets(["//..."], {}), true);
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//projects/apps/my-app/..."], {}),
    false,
  );
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//build-tools/tools/tests/..."], {}),
    true,
  );
});

test("verify seed policy honors override mode", () => {
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//projects/apps/my-app/..."], {
      BNX_VERIFY_SEED_MODE: "always",
    }),
    true,
  );
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//..."], { BNX_VERIFY_SEED_MODE: "never" }),
    false,
  );
});

test("verify seed staging stays outside volatile verify TMPDIR", () => {
  const root = seedStageRootDirForTest();
  if (process.platform === "win32") {
    assert.equal(root, path.join(os.tmpdir(), "viberoots-test-seed"));
    return;
  }
  assert.ok(root.startsWith("/tmp/viberoots-test-seed"));
  assert.ok(!root.includes("/viberoots-verify"));
});

test("verify seed staging rebuilds stale ready stages missing required repo files", async () => {
  const seed = await mktemp("seed-stage-source-");
  const requiredFiles = [
    "flake.nix",
    ".buckconfig",
    "eslint.config.js",
    path.join("build-tools", "deployments", "defs.bzl"),
    path.join("build-tools", "tools", "buck", "export-graph.ts"),
    path.join("build-tools", "tools", "dev", "zx-init.mjs"),
    path.join("build-tools", "tools", "node", "gen-wasm-inline-module.ts"),
  ];
  for (const rel of requiredFiles) {
    const abs = path.join(seed, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, `${rel}\n`, "utf8");
  }
  const key = `seed-stage-stale-${process.pid}-${Date.now()}`;
  const staged = await stageSeedStore(seed, key, 60_000);
  await fsp.chmod(staged, 0o755);
  await fsp.rm(path.join(staged, "eslint.config.js"));

  const rebuilt = await stageSeedStore(seed, key, 60_000);

  assert.equal(rebuilt, staged);
  assert.equal(
    await fsp.readFile(path.join(rebuilt, "eslint.config.js"), "utf8"),
    "eslint.config.js\n",
  );
});

test("verify seed staging publishes read-only shared stages", async () => {
  const seed = await mktemp("seed-stage-readonly-source-");
  const requiredFiles = [
    "flake.nix",
    ".buckconfig",
    "eslint.config.js",
    path.join("build-tools", "deployments", "defs.bzl"),
    path.join("build-tools", "tools", "buck", "export-graph.ts"),
    path.join("build-tools", "tools", "dev", "zx-init.mjs"),
    path.join("build-tools", "tools", "node", "gen-wasm-inline-module.ts"),
  ];
  for (const rel of requiredFiles) {
    const abs = path.join(seed, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, `${rel}\n`, "utf8");
  }

  const key = `seed-stage-readonly-${process.pid}-${Date.now()}`;
  const staged = await stageSeedStore(seed, key, 60_000);
  const rootMode = (await fsp.stat(staged)).mode;
  const flakeMode = (await fsp.stat(path.join(staged, "flake.nix"))).mode;

  assert.equal(rootMode & 0o222, 0);
  assert.equal(flakeMode & 0o222, 0);
  await assert.rejects(fsp.access(path.join(staged, ".seed-store-writable")));
});
