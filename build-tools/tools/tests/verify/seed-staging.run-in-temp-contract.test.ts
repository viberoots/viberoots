#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { overlayActiveViberootsIntoStage } from "../../dev/verify/seed-stage-source-overlay";
import { mktemp } from "../lib/test-helpers";
import { stageTempRepoPaths } from "../lib/test-helpers/git-stage";
import { readRepoFile } from "./seed-staging-fixture";

test("verify seed staging tests never use the shared production stage root", async () => {
  for (const relativePath of [
    "build-tools/tools/tests/verify/seed-staging.layout-and-ownership.test.ts",
    "build-tools/tools/tests/verify/seed-staging.content.test.ts",
    "build-tools/tools/tests/verify/seed-stage-alias-pin.test.ts",
  ]) {
    const source = await readRepoFile(relativePath);
    const stageCallBlocks = source
      .split(/\n\s*test\(/)
      .filter((block) => block.includes("stageSeedStore("));
    for (const block of stageCallBlocks) {
      assert.ok(
        block.includes("withSeedStageRoot(") ||
          block.includes("withIsolatedSeedStageRoot(") ||
          block.includes("workspaceRoot") ||
          block.includes("VBR_VERIFY_SEED_STAGE_ROOT"),
        `stageSeedStore test block must isolate the shared stage root:\n${block.slice(0, 240)}`,
      );
    }
  }
});

test("runInTemp seed overlay refreshes active viberoots source", async () => {
  const source = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/seed-viberoots-overlay.ts",
  );
  const runInTempSource = [
    await readRepoFile("build-tools/tools/tests/lib/test-helpers/run-in-temp/filtered-inputs.ts"),
    await readRepoFile("build-tools/tools/tests/lib/test-helpers/run-in-temp/flake-rewrite.ts"),
    await readRepoFile("build-tools/tools/tests/lib/test-helpers/run-in-temp/seeded-setup.ts"),
  ].join("\n");
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

test("verify seed overlay uses a remote consumer's declared current source", async () => {
  const root = await mktemp("verify-seed-remote-current-");
  const source = await mktemp("verify-seed-remote-source-");
  const stage = await mktemp("verify-seed-remote-stage-");
  try {
    await fsp.mkdir(path.join(source, "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(
      path.join(source, "build-tools", "tools", "dev", "zx-init.mjs"),
      "export {};\n",
      "utf8",
    );
    await fsp.mkdir(path.join(root, ".viberoots"), { recursive: true });
    await fsp.symlink(source, path.join(root, ".viberoots", "current"));
    await fsp.writeFile(path.join(root, "consumer-generated.txt"), "consumer\n", "utf8");
    await $({ cwd: root, stdio: "pipe" })`git init -q`;

    assert.deepEqual(await overlayActiveViberootsIntoStage(stage, root), []);
    await assert.rejects(fsp.access(path.join(stage, "viberoots", "consumer-generated.txt")));
  } finally {
    await Promise.all(
      [root, source, stage].map((dir) => fsp.rm(dir, { recursive: true, force: true })),
    );
  }
});

test("runInTemp seed overlay honors prepared seed marker version", async () => {
  const viberootsOverlaySource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/seed-viberoots-overlay.ts",
  );
  const worktreeOverlaySource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/seed-worktree-overlay.ts",
  );
  const runInTempSource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/run-in-temp/seeded-overlays.ts",
  );
  const flakeRewriteSource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/run-in-temp/flake-rewrite.ts",
  );
  const seedMarkerSource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/seed-store-config.ts",
  );
  const seedLayoutSource = await readRepoFile("build-tools/tools/dev/verify/seed-stage-layout.ts");

  assert.match(seedMarkerSource, /PREPARED_SEED_MARKER = "\.seed-store-prepared-v9"/);
  for (const source of [
    viberootsOverlaySource,
    worktreeOverlaySource,
    runInTempSource,
    flakeRewriteSource,
  ]) {
    assert.match(source, /import \{ PREPARED_SEED_MARKER \}/);
    assert.match(source, /path\.join\([^\n]*PREPARED_SEED_MARKER\)/);
    assert.doesNotMatch(source, /\.seed-store-prepared-v8/);
    assert.doesNotMatch(source, /\.seed-store-prepared-v6/);
    assert.doesNotMatch(source, /\.seed-store-prepared-v5/);
  }
  assert.match(seedLayoutSource, /\.seed-store-prepared-v9/);
  assert.doesNotMatch(seedLayoutSource, /\.seed-store-prepared-v8/);
  assert.doesNotMatch(seedLayoutSource, /\.seed-store-prepared-v[56]/);
  assert.match(viberootsOverlaySource, /if \(prepared\) return \[\]/);
  assert.match(
    worktreeOverlaySource,
    /if \(prepared && rel\.startsWith\("viberoots\/"\)\) continue/,
  );
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
  assert.match(seedCopySource, /PREPARED_SEED_MARKER/);
  assert.match(seedCopySource, /clonefile\(src\.encode\(\), dst\.encode\(\), 0\)/);
  assert.doesNotMatch(seedCopySource, /repair_permissions/);
});

test("temp-repo staging routes parent and nested paths to their owning Git indexes", async () => {
  const root = await mktemp("temp-repo-mixed-git-stage-");
  const nested = path.join(root, "viberoots");
  try {
    await fsp.mkdir(nested, { recursive: true });
    await Promise.all([
      $({ cwd: root, stdio: "pipe" })`git init -q`,
      $({ cwd: nested, stdio: "pipe" })`git init -q`,
    ]);
    await Promise.all([
      fsp.writeFile(path.join(root, "parent.txt"), "parent\n"),
      fsp.writeFile(path.join(nested, "nested.txt"), "nested\n"),
    ]);

    await stageTempRepoPaths({
      tmp: root,
      _$: $,
      explicitPaths: ["parent.txt", "viberoots/nested.txt"],
    });

    const parentStaged = await $({ cwd: root, stdio: "pipe" })`git diff --cached --name-only`;
    const nestedStaged = await $({ cwd: nested, stdio: "pipe" })`git diff --cached --name-only`;
    assert.equal(String(parentStaged.stdout).trim(), "parent.txt");
    assert.equal(String(nestedStaged.stdout).trim(), "nested.txt");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("prepared runInTemp seeds validate nested Git identity without re-indexing it", async () => {
  const gitBootstrapSource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/run-in-temp/git-bootstrap.ts",
  );

  assert.match(gitBootstrapSource, /if \(!opts\.stageAll && opts\.touchedRelPaths\.length === 0\)/);
  assert.match(gitBootstrapSource, /if \(opts\.stageAll\) await git`git add -A`/);
  assert.match(gitBootstrapSource, /prepared seed gitlink mismatch/);
  const seedPrepareSource = await readRepoFile(
    "build-tools/tools/dev/verify/seed-stage-prepare.ts",
  );
  assert.match(seedPrepareSource, /git repack -a -d -q --threads=1/);
  assert.match(seedPrepareSource, /git fsck --full --no-dangling/);
  assert.match(seedPrepareSource, /git count-objects -v/);
  assert.match(seedPrepareSource, /objects", "info", "alternates"/);
});

test("runInTemp uses one user-global dependency cache authority in seeded and scratch repos", async () => {
  for (const relativePath of [
    "build-tools/tools/tests/lib/test-helpers/run-in-temp/seeded-setup.ts",
    "build-tools/tools/tests/lib/test-helpers/run-in-temp/runtime-env.ts",
    "build-tools/tools/tests/lib/test-helpers/run-in-temp/scratch-runner.ts",
  ]) {
    const source = await readRepoFile(relativePath);
    assert.match(source, /sharedPnpmStoreHashCacheRoot\(\s*process\.env,\s*realHome,?\s*\)/);
    assert.match(source, /sharedCargoFixedSourceCacheRoot\(\s*process\.env,\s*realHome,?\s*\)/);
    assert.doesNotMatch(source, /VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT[^\n]*process\.cwd\(\)/);
    assert.doesNotMatch(source, /VBR_SHARED_CARGO_FIXED_SOURCE_CACHE_ROOT[^\n]*process\.cwd\(\)/);
  }
});

test("update-command launcher materializes the complete filtered working-tree source", async () => {
  const source = await readRepoFile(
    "build-tools/tools/tests/dev/update-command-launcher.fixture.ts",
  );

  assert.match(source, /prepareFilteredViberootsInput\(VIBEROOTS_SOURCE_ROOT\)/);
  assert.doesNotMatch(source, /checkout-index/);
});

test("update-command launcher inherits canonical shared dependency cache authorities", async () => {
  const source = await readRepoFile(
    "build-tools/tools/tests/dev/update-command-launcher.fixture.ts",
  );

  assert.match(
    source,
    /import\s*\{\s*sharedPnpmStoreHashCacheRoot\s*\}\s*from\s*"\.\.\/\.\.\/dev\/update-pnpm-hash\/verified-marker"/,
  );
  assert.match(
    source,
    /import\s*\{\s*sharedCargoFixedSourceCacheRoot\s*\}\s*from\s*"\.\.\/\.\.\/dev\/install\/cargo-fixed-source-cache"/,
  );
  assert.match(source, /sharedPnpmStoreHashCacheRoot\(\s*process\.env\s*,\s*os\.homedir\(\)\s*\)/);
  assert.match(
    source,
    /sharedCargoFixedSourceCacheRoot\(\s*process\.env\s*,\s*os\.homedir\(\)\s*\)/,
  );
  assert.match(source, /VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT:\s*[\s\S]*sharedHashCacheRoot/);
  assert.match(source, /VBR_SHARED_CARGO_FIXED_SOURCE_CACHE_ROOT:\s*[\s\S]*sharedCargoCacheRoot/);
  assert.doesNotMatch(source, /VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT[^\n]*process\.cwd\(\)/);
  assert.doesNotMatch(source, /VBR_SHARED_CARGO_FIXED_SOURCE_CACHE_ROOT[^\n]*process\.cwd\(\)/);
});
