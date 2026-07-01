#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { seedStageRootDirForTest, stageSeedStore } from "../../dev/verify/seed-staging";
import { mktemp } from "../lib/test-helpers";

async function readRepoFile(relativePath: string): Promise<string> {
  for (const candidate of [relativePath, path.join("viberoots", relativePath)]) {
    try {
      return await fsp.readFile(candidate, "utf8");
    } catch {}
  }
  return await fsp.readFile(relativePath, "utf8");
}

const REQUIRED_STAGE_FILES = [
  "flake.nix",
  ".buckconfig",
  "eslint.config.js",
  path.join("build-tools", "deployments", "defs.bzl"),
  path.join("build-tools", "tools", "buck", "export-graph.ts"),
  path.join("build-tools", "tools", "dev", "zx-init.mjs"),
  path.join("build-tools", "tools", "node", "gen-wasm-inline-module.ts"),
];

async function writeRequiredStageFiles(seed: string): Promise<void> {
  for (const rel of REQUIRED_STAGE_FILES) {
    const abs = path.join(seed, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, `${rel}\n`, "utf8");
  }
}

test("verify seed staging stays outside volatile verify TMPDIR", () => {
  const root = seedStageRootDirForTest();
  if (process.platform === "win32") {
    assert.equal(root, path.join(os.tmpdir(), "viberoots-test-seed"));
    return;
  }
  if (process.platform === "darwin") {
    assert.ok(root.startsWith("/tmp/viberoots-test-seed"));
    assert.ok(root.endsWith(".noindex"));
    assert.ok(!root.includes("/viberoots-verify"));
    return;
  }
  assert.ok(root.startsWith("/tmp/viberoots-test-seed"));
  assert.ok(!root.includes("/viberoots-verify"));
});

test("verify seed staging rebuilds stale ready stages missing required repo files", async () => {
  const seed = await mktemp("seed-stage-source-");
  await writeRequiredStageFiles(seed);
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

test("verify seed staging publishes copy-ready writable shared stages", async () => {
  const seed = await mktemp("seed-stage-readonly-source-");
  await writeRequiredStageFiles(seed);

  const key = `seed-stage-readonly-${process.pid}-${Date.now()}`;
  const staged = await stageSeedStore(seed, key, 60_000);
  const rootMode = (await fsp.stat(staged)).mode;
  const flakeMode = (await fsp.stat(path.join(staged, "flake.nix"))).mode;

  assert.notEqual(rootMode & 0o200, 0);
  assert.notEqual(flakeMode & 0o200, 0);
  if (process.platform === "darwin") {
    await fsp.stat(path.join(staged, ".metadata_never_index"));
  }
  await assert.rejects(fsp.access(path.join(staged, ".seed-store-writable")));
});

test("verify seed staging excludes nested viberoots generated state", async () => {
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

  const key = `seed-stage-generated-${process.pid}-${Date.now()}`;
  const staged = await stageSeedStore(seed, key, 60_000);

  assert.equal(
    await fsp.readFile(path.join(staged, "viberoots", "build-tools", "keep.txt"), "utf8"),
    "keep\n",
  );
  await assert.rejects(fsp.access(path.join(staged, "viberoots", ".direnv")));
  await assert.rejects(fsp.access(path.join(staged, "viberoots", ".nix-gcroots")));
  await assert.rejects(fsp.access(path.join(staged, "viberoots", "buck-out")));
  await assert.rejects(fsp.access(path.join(staged, "viberoots", "node_modules")));
});

test("verify seed staging invalidates older prepared marker versions", async () => {
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

test("verify seed staging rewrites lock metadata after placeholder mutation", async () => {
  const source = await readRepoFile("build-tools/tools/dev/verify/seed-staging.ts");

  assert.match(source, /\.seed-store-prepared-v7/);
  assert.doesNotMatch(source, /\.seed-store-prepared-v6/);
  assert.ok(
    source.indexOf("...(await ensurePnpmfilePlaceholders(stageDir)),") <
      source.indexOf("...(await rewriteStageViberootsInput(stageDir)),"),
  );
  assert.match(source, /nix flake prefetch --json/);
  assert.match(source, /nix hash path --sri/);
});

test("runInTemp seed overlay refreshes active viberoots source", async () => {
  const source = await readRepoFile("build-tools/tools/tests/lib/test-helpers/seed-store.ts");
  const runInTempSource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/run-in-temp.ts",
  );
  assert.match(source, /const tmpViberoots = path\.join\(tmpDir, "viberoots"\)/);
  assert.match(source, /listActiveSourceOverlayFiles/);
  assert.match(source, /rsync -a --relative --files-from/);
  assert.doesNotMatch(source, /fsp\.rm\(tmpViberoots, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(source, /rsync -a --delete/);
  assert.doesNotMatch(source, /if \(tmpHasActiveViberootsRoot\) return/);
  assert.match(runInTempSource, /rewriteTempViberootsInput/);
  assert.match(runInTempSource, /viberoots\\.url/);
  assert.match(runInTempSource, /path:\$\{activeViberootsRoot\}/);
  assert.match(runInTempSource, /VIBEROOTS_FLAKE_INPUT_ROOT/);
  assert.match(runInTempSource, /rewriteTempViberootsInput after setup/);
  assert.match(runInTempSource, /path\.join\(root, "flake\.nix"\)/);
  assert.match(runInTempSource, /import\.meta\.url/);
});

test("runInTemp seed overlay honors prepared seed marker version", async () => {
  const seedStoreSource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/seed-store.ts",
  );
  const runInTempSource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/run-in-temp.ts",
  );
  const seedStagingSource = await readRepoFile("build-tools/tools/dev/verify/seed-staging.ts");

  for (const source of [seedStoreSource, runInTempSource, seedStagingSource]) {
    assert.match(source, /\.seed-store-prepared-v7/);
    assert.doesNotMatch(source, /\.seed-store-prepared-v6/);
    assert.doesNotMatch(source, /\.seed-store-prepared-v5/);
  }
  assert.match(seedStoreSource, /if \(prepared\) return \[\]/);
  assert.match(seedStoreSource, /if \(prepared && rel\.startsWith\("viberoots\/"\)\) continue/);
});

test("runInTemp seed copies do not repair permissions with broad chmod", async () => {
  const seedStoreSource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/seed-store.ts",
  );
  const seedCopySource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/seed-copy.ts",
  );

  assert.doesNotMatch(seedStoreSource, /chmod -R u\+w/);
  assert.match(seedCopySource, /copySeedStoreToTempRepo/);
  assert.match(seedCopySource, /mkdirWithMacosMetadataExclusion\(stagingDir\)/);
  assert.doesNotMatch(seedCopySource, /shutil\.rmtree\(dst_root\)/);
  assert.match(seedCopySource, /makeDirectoryPublishable\(stagingDir\)/);
  assert.match(seedCopySource, /process\.platform !== "darwin"/);
  assert.match(seedCopySource, /makeTreeWritable\(stagingDir\)/);
  assert.match(seedCopySource, /\.seed-store-prepared-v7/);
  assert.match(seedCopySource, /repair_permissions = sys\.argv\[3\] == "1"/);
});
