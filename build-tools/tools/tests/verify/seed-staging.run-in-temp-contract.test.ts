#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
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

  assert.match(seedMarkerSource, /PREPARED_SEED_MARKER = "\.seed-store-prepared-v7"/);
  for (const source of [
    viberootsOverlaySource,
    worktreeOverlaySource,
    runInTempSource,
    flakeRewriteSource,
  ]) {
    assert.match(source, /import \{ PREPARED_SEED_MARKER \}/);
    assert.match(source, /path\.join\([^\n]*PREPARED_SEED_MARKER\)/);
    assert.doesNotMatch(source, /\.seed-store-prepared-v6/);
    assert.doesNotMatch(source, /\.seed-store-prepared-v5/);
  }
  assert.match(seedLayoutSource, /\.seed-store-prepared-v7/);
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
  assert.match(seedCopySource, /\.seed-store-prepared-v7/);
  assert.match(seedCopySource, /repair_permissions = sys\.argv\[3\] == "1"/);
});
