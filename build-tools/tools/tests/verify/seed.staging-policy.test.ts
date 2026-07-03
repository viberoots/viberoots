#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { seedStageRootDirForTest, stageSeedStore } from "../../dev/verify/seed-staging";
import { mktemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readRepoFile(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

const REQUIRED_STAGE_FILES = [
  "flake.nix",
  ".buckconfig",
  "eslint.config.js",
  path.join(".viberoots", "workspace", "flake.nix"),
  path.join("build-tools", "deployments", "defs.bzl"),
  path.join("build-tools", "tools", "buck", "export-graph.ts"),
  path.join("build-tools", "tools", "dev", "zx-init.mjs"),
  path.join("build-tools", "tools", "node", "gen-wasm-inline-module.ts"),
  path.join("viberoots", "eslint.config.js"),
  path.join("viberoots", "build-tools", "deployments", "defs.bzl"),
  path.join("viberoots", "build-tools", "tools", "buck", "export-graph.ts"),
  path.join("viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
  path.join("viberoots", "build-tools", "tools", "node", "gen-wasm-inline-module.ts"),
  path.join("viberoots", "flake.nix"),
];

async function writeRequiredStageFiles(seed: string): Promise<void> {
  for (const rel of REQUIRED_STAGE_FILES) {
    const abs = path.join(seed, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, `${rel}\n`, "utf8");
  }
}

async function initGitSeed(seed: string): Promise<void> {
  await $({ cwd: seed, stdio: "pipe" })`git init -q`;
  await $({ cwd: seed, stdio: "pipe" })`git add .`;
  await $({
    cwd: seed,
    stdio: "pipe",
  })`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m seed`;
}

async function withSeedStageRoot<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.VBR_VERIFY_SEED_STAGE_ROOT;
  try {
    process.env.VBR_VERIFY_SEED_STAGE_ROOT = root;
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.VBR_VERIFY_SEED_STAGE_ROOT;
    else process.env.VBR_VERIFY_SEED_STAGE_ROOT = previous;
  }
}

async function withIsolatedSeedStageRoot<T>(fn: () => Promise<T>): Promise<T> {
  const stageRoot = await mktemp("seed-stage-root-");
  return await withSeedStageRoot(stageRoot, fn);
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

test("verify seed staging prunes stale shared stage directories", async () => {
  const stageRoot = await mktemp("seed-stage-root-");
  const seed = await mktemp("seed-stage-prune-source-");
  await writeRequiredStageFiles(seed);
  const staleStage = path.join(stageRoot, "seed-stale");
  const staleLock = path.join(stageRoot, "lock-stale");
  await fsp.mkdir(staleStage, { recursive: true });
  await fsp.writeFile(path.join(staleStage, "old.txt"), "old\n", "utf8");
  await fsp.mkdir(staleLock, { recursive: true });
  await fsp.writeFile(
    path.join(staleLock, "owner.json"),
    JSON.stringify({ pid: 999_999, startedAt: "1970-01-01T00:00:00.000Z" }) + "\n",
    "utf8",
  );
  const old = new Date("1970-01-01T00:00:00.000Z");
  await fsp.utimes(staleStage, old, old);

  await withSeedStageRoot(stageRoot, async () => {
    const key = `seed-stage-prune-${process.pid}-${Date.now()}`;
    await stageSeedStore(seed, key, 24 * 60 * 60 * 1000);
  });

  await assert.rejects(fsp.access(staleStage));
  await assert.rejects(fsp.access(staleLock));
});

test("verify seed staging preserves stale stages pinned by live verify runs", async () => {
  const stageRoot = await mktemp("seed-stage-root-");
  const workspaceRoot = await mktemp("seed-stage-workspace-");
  const seed = await mktemp("seed-stage-prune-source-");
  await writeRequiredStageFiles(seed);
  await initGitSeed(seed);
  const staleStage = path.join(stageRoot, "seed-live-pinned");
  await fsp.mkdir(staleStage, { recursive: true });
  await fsp.writeFile(path.join(staleStage, "old.txt"), "old\n", "utf8");
  const pinDir = path.join(
    workspaceRoot,
    ".viberoots",
    "workspace",
    "buck",
    "verify-seed",
    "pins",
    "live",
  );
  await fsp.mkdir(pinDir, { recursive: true });
  await fsp.writeFile(
    path.join(pinDir, "owner.json"),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n",
    "utf8",
  );
  await fsp.symlink(staleStage, path.join(pinDir, "seed"));
  const old = new Date("1970-01-01T00:00:00.000Z");
  await fsp.utimes(staleStage, old, old);

  await withSeedStageRoot(stageRoot, async () => {
    const key = `seed-stage-prune-${process.pid}-${Date.now()}`;
    await stageSeedStore(seed, key, 24 * 60 * 60 * 1000, { workspaceRoot });
  });

  await fsp.access(staleStage);
});

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

test("verify seed staging tests never use the shared production stage root", async () => {
  const source = await fsp.readFile(import.meta.filename, "utf8");
  const stageCallBlocks = source
    .split(/\n\s*test\(/)
    .filter((block) => block.includes("stageSeedStore("));

  for (const block of stageCallBlocks) {
    if (block.includes("verify seed staging tests never use the shared production stage root")) {
      continue;
    }
    assert.ok(
      block.includes("withSeedStageRoot(") ||
        block.includes("withIsolatedSeedStageRoot(") ||
        block.includes("workspaceRoot"),
      `stageSeedStore test block must isolate the shared stage root:\n${block.slice(0, 240)}`,
    );
  }
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
