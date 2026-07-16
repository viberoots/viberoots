#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { stageSeedStore } from "../../dev/verify/seed-staging";
import { mktemp } from "../lib/test-helpers";
import {
  readRepoFile,
  withIsolatedSeedStageRoot,
  writeRequiredStageFiles,
} from "./seed-staging-fixture";

test("verify seed staging rebuilds stale ready stages missing required repo files", async () => {
  await withIsolatedSeedStageRoot(async () => {
    const seed = await mktemp("seed-stage-source-");
    await writeRequiredStageFiles(seed);
    const key = `seed-stage-stale-${process.pid}-${Date.now()}`;
    const staged = await stageSeedStore(seed, key, 60_000);
    await fsp.chmod(staged, 0o755);
    await fsp.rm(path.join(staged, "viberoots", "eslint.config.js"));

    const rebuilt = await stageSeedStore(seed, key, 60_000);

    assert.equal(rebuilt, staged);
    assert.equal(
      await fsp.readFile(path.join(rebuilt, "eslint.config.js"), "utf8"),
      "eslint.config.js\n",
    );
    assert.equal(
      await fsp.readFile(path.join(rebuilt, "viberoots", "eslint.config.js"), "utf8"),
      path.join("viberoots", "eslint.config.js") + "\n",
    );
  });
});

test("verify seed staging publishes copy-ready writable shared stages", async () => {
  await withIsolatedSeedStageRoot(async () => {
    const seed = await mktemp("seed-stage-readonly-source-");
    await writeRequiredStageFiles(seed);
    const staged = await stageSeedStore(
      seed,
      `seed-stage-readonly-${process.pid}-${Date.now()}`,
      60_000,
    );
    const rootMode = (await fsp.stat(staged)).mode;
    const flakeMode = (await fsp.stat(path.join(staged, "flake.nix"))).mode;

    assert.notEqual(rootMode & 0o200, 0);
    assert.notEqual(flakeMode & 0o200, 0);
    if (process.platform === "darwin") await fsp.stat(path.join(staged, ".metadata_never_index"));
    await assert.rejects(fsp.access(path.join(staged, ".seed-store-writable")));
  });
});

test("verify seed staging excludes nested viberoots generated state", async () => {
  await withIsolatedSeedStageRoot(async () => {
    const seed = await mktemp("seed-stage-generated-source-");
    await writeRequiredStageFiles(seed);
    await fsp.mkdir(path.join(seed, "viberoots", "build-tools"), { recursive: true });
    await fsp.writeFile(path.join(seed, "viberoots", "build-tools", "keep.txt"), "keep\n", "utf8");
    for (const rel of [
      path.join("viberoots", ".direnv", "flake-profile.rc"),
      path.join("viberoots", ".nix-gcroots", "devshell"),
      path.join("viberoots", "buck-out", "v2", "cache"),
      path.join("viberoots", "node_modules", ".bin", "tool"),
    ]) {
      const abs = path.join(seed, rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, "generated\n", "utf8");
    }

    const staged = await stageSeedStore(
      seed,
      `seed-stage-generated-${process.pid}-${Date.now()}`,
      60_000,
    );
    assert.equal(
      await fsp.readFile(path.join(staged, "viberoots", "build-tools", "keep.txt"), "utf8"),
      "keep\n",
    );
    await assert.rejects(fsp.access(path.join(staged, "viberoots", ".direnv")));
    await assert.rejects(fsp.access(path.join(staged, "viberoots", ".nix-gcroots")));
    await assert.rejects(fsp.access(path.join(staged, "viberoots", "buck-out")));
    await assert.rejects(fsp.access(path.join(staged, "viberoots", "node_modules")));
  });
});

test("verify seed staging invalidates older prepared marker versions", async () => {
  await withIsolatedSeedStageRoot(async () => {
    const seed = await mktemp("seed-stage-marker-source-");
    await writeRequiredStageFiles(seed);
    const key = `seed-stage-marker-${process.pid}-${Date.now()}`;
    const staged = await stageSeedStore(seed, key, 60_000);
    await fsp.rename(
      path.join(staged, ".seed-store-prepared-v7"),
      path.join(staged, ".seed-store-prepared-v6"),
    );
    await fsp.writeFile(path.join(seed, "eslint.config.js"), "eslint.config.js changed\n", "utf8");

    const rebuilt = await stageSeedStore(seed, key, 60_000);
    assert.equal(rebuilt, staged);
    assert.equal(
      await fsp.readFile(path.join(rebuilt, "eslint.config.js"), "utf8"),
      "eslint.config.js changed\n",
    );
    await fsp.access(path.join(rebuilt, ".seed-store-prepared-v7"));
    await assert.rejects(fsp.access(path.join(rebuilt, ".seed-store-prepared-v6")));
  });
});

test("verify seed staging rewrites lock metadata after placeholder mutation", async () => {
  const layout = await readRepoFile("build-tools/tools/dev/verify/seed-stage-layout.ts");
  const prepare = await readRepoFile("build-tools/tools/dev/verify/seed-stage-prepare.ts");
  const flakeInput = await readRepoFile("build-tools/tools/dev/verify/seed-stage-flake-input.ts");

  assert.match(layout, /\.seed-store-prepared-v7/);
  assert.doesNotMatch(layout, /\.seed-store-prepared-v6/);
  assert.ok(
    prepare.indexOf("...(await ensurePnpmfilePlaceholders(stageDir)),") <
      prepare.indexOf("...(await rewriteStageViberootsInput(stageDir)),"),
  );
  assert.match(flakeInput, /nix flake prefetch --json/);
  assert.match(flakeInput, /nix hash path --sri/);
});
