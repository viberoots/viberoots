#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { commitNestedViberoots } from "../../dev/verify/seed-stage-prepare";
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
      path.join(staged, ".seed-store-prepared-v9"),
      path.join(staged, ".seed-store-prepared-v8"),
    );
    await fsp.writeFile(path.join(seed, "eslint.config.js"), "eslint.config.js changed\n", "utf8");

    const rebuilt = await stageSeedStore(seed, key, 60_000);
    assert.equal(rebuilt, staged);
    assert.equal(
      await fsp.readFile(path.join(rebuilt, "eslint.config.js"), "utf8"),
      "eslint.config.js changed\n",
    );
    await fsp.access(path.join(rebuilt, ".seed-store-prepared-v9"));
    await assert.rejects(fsp.access(path.join(rebuilt, ".seed-store-prepared-v8")));
  });
});

test("verify seed staging rewrites lock metadata after placeholder mutation", async () => {
  const layout = await readRepoFile("build-tools/tools/dev/verify/seed-stage-layout.ts");
  const prepare = await readRepoFile("build-tools/tools/dev/verify/seed-stage-prepare.ts");
  const flakeInput = await readRepoFile("build-tools/tools/dev/verify/seed-stage-flake-input.ts");

  assert.match(layout, /\.seed-store-prepared-v9/);
  assert.doesNotMatch(layout, /\.seed-store-prepared-v8/);
  assert.ok(
    prepare.indexOf("...(await ensurePnpmfilePlaceholders(stageDir)),") <
      prepare.indexOf("...(await rewriteStageViberootsInput(stageDir)),"),
  );
  assert.match(flakeInput, /nix flake prefetch --json/);
  assert.match(flakeInput, /nix hash path --sri/);
});

test("verify seed staging packs an independent nested Git repository", async () => {
  const stage = await mktemp("seed-stage-packed-git-");
  const nested = path.join(stage, "viberoots");
  const copied = await mktemp("seed-stage-packed-copy-");
  try {
    await fsp.mkdir(nested, { recursive: true });
    await fsp.writeFile(path.join(nested, "overlay.txt"), "committed overlay\n");
    await $({ cwd: stage, stdio: "pipe" })`git init -q`;

    await commitNestedViberoots(stage);

    const nestedGit = $({ cwd: nested, stdio: "pipe" });
    const head = String((await nestedGit`git rev-parse HEAD`).stdout).trim();
    assert.match(head, /^[0-9a-f]{40}$/);
    assert.equal(
      String((await $({ cwd: stage, stdio: "pipe" })`git ls-files -s -- viberoots`).stdout).trim(),
      `160000 ${head} 0\tviberoots`,
    );
    await nestedGit`git fsck --full --no-dangling`;
    const counts = String((await nestedGit`git count-objects -v`).stdout);
    assert.match(counts, /^count: 0$/m);
    const packs = Number(counts.match(/^packs: (\d+)$/m)?.[1] ?? 0);
    assert.ok(packs >= 1);
    const packFiles = await fsp.readdir(path.join(nested, ".git", "objects", "pack"));
    assert.equal(packFiles.filter((file) => file.endsWith(".pack")).length, packs);
    assert.equal(packFiles.filter((file) => file.endsWith(".idx")).length, packs);
    assert.ok(packFiles.length <= packs * 2 + 1, "nested Git metadata must scale with pack files");
    await assert.rejects(fsp.access(path.join(nested, ".git", "objects", "info", "alternates")));
    assert.equal(
      String((await nestedGit`git show HEAD:overlay.txt`).stdout),
      "committed overlay\n",
    );

    await fsp.cp(nested, copied, { recursive: true, force: true });
    const copiedGit = $({ cwd: copied, stdio: "pipe" });
    assert.equal(String((await copiedGit`git rev-parse HEAD`).stdout).trim(), head);
    assert.equal(
      String((await copiedGit`git show HEAD:overlay.txt`).stdout),
      "committed overlay\n",
    );
    await copiedGit`git fsck --full --no-dangling`;
  } finally {
    await Promise.all([stage, copied].map((dir) => fsp.rm(dir, { recursive: true, force: true })));
  }
});
