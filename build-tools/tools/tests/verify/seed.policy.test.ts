#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { shouldPrepareVerifySeedForRequestedTargets } from "../../dev/verify/seed";
import { verifySeedBuildArgs } from "../../dev/verify/seed-build";
import { writeVerifySeedRemoteManifest } from "../../dev/verify/seed-manifest";
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

test("verify seed build policy defaults to full-suite only", () => {
  assert.equal(shouldPrepareVerifySeedForRequestedTargets(["//..."], {}), true);
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//projects/apps/my-app/..."], {}),
    false,
  );
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//projects/...", "//viberoots/..."], {}),
    true,
  );
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["@viberoots//build-tools/tools/tests/..."], {}),
    true,
  );
});

test("verify seed policy honors override mode", () => {
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//projects/apps/my-app/..."], {
      VBR_VERIFY_SEED_MODE: "always",
    }),
    true,
  );
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//..."], { VBR_VERIFY_SEED_MODE: "never" }),
    false,
  );
});

test("verify seed build args split local pinning from remote-ready no-link mode", () => {
  assert.deepEqual(
    verifySeedBuildArgs({
      root: "/repo",
      mode: "local",
      gcRootPath: "/repo/.viberoots/workspace/buck/verify-seed/nix-root",
    }).slice(-3),
    ["--out-link", "/repo/.viberoots/workspace/buck/verify-seed/nix-root", "--print-out-paths"],
  );
  const remoteArgs = verifySeedBuildArgs({ root: "/repo", mode: "remote-ready" });
  assert.ok(remoteArgs.includes("--no-link"));
  assert.ok(remoteArgs.includes("--print-out-paths"));
  assert.ok(!remoteArgs.includes("--out-link"));
});

test("verify seed reuses matching current seed before building", async () => {
  const source = await readRepoFile("build-tools/tools/dev/verify/seed.ts");
  const currentLookup = source.indexOf("await readCurrentSeed(opts.root, seedKey)");
  const buildCall = source.indexOf("await buildSeedStorePath(opts.root, mode)");
  assert.ok(currentLookup > 0, "prepareVerifySeed must read current seed state");
  assert.ok(buildCall > currentLookup, "prepareVerifySeed must try current seed before nix build");
  assert.match(source, /\.viberoots", "workspace", "buck", "verify-seed"/);
  assert.doesNotMatch(source, /"buck-out", "tmp", "verify-seed"/);
});

test("verify seed key includes active viberoots submodule state", async () => {
  const source = await readRepoFile("build-tools/tools/dev/verify/seed.ts");
  assert.match(source, /const viberootsRoot = path\.join\(root, "viberoots"\)/);
  assert.match(source, /computeGitState\(viberootsRoot\)/);
  assert.match(source, /viberootsGit/);
});

test("verify seed snapshot excludes generated workspace buck state", async () => {
  const source = await readRepoFile("build-tools/tools/nix/flake/packages/filter-seed-repo.nix");
  const seedSource = await readRepoFile("build-tools/tools/nix/flake/packages/test-seed.nix");
  const seedStagingSource = await readRepoFile("build-tools/tools/dev/verify/seed-staging.ts");
  const seedCopySource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/seed-copy.ts",
  );
  const seedStoreSource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/seed-store.ts",
  );
  const rsyncSource = await readRepoFile("build-tools/tools/tests/lib/test-helpers/rsync.ts");
  assert.match(source, /rel == "\.viberoots\/workspace\/buck"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/workspace\/buck\/" rel/);
  assert.match(source, /rel == "\.viberoots\/workspace\/\.viberoots"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/workspace\/\.viberoots\/" rel/);
  assert.match(source, /rel == "\.viberoots\/workspace\/codex-test-logs"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/workspace\/codex-test-logs\/" rel/);
  assert.match(source, /rel == "\.viberoots\/buck"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/buck\/" rel/);
  assert.match(source, /rel == "\.viberoots\/cache"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/cache\/" rel/);
  assert.match(source, /rel == "\.viberoots\/codex-logs"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/codex-logs\/" rel/);
  assert.match(source, /rel == "build-tools\/tmp"/);
  assert.match(source, /lib\.hasPrefix "build-tools\/tmp\/" rel/);
  assert.match(source, /rel == "viberoots\/\.viberoots"/);
  assert.match(source, /lib\.hasPrefix "viberoots\/\.viberoots\/" rel/);
  assert.match(seedSource, /"\$out\/\.viberoots\/buck"/);
  assert.match(seedSource, /"\$out\/\.viberoots\/codex-logs"/);
  assert.match(seedSource, /"\$out\/\.viberoots\/workspace\/\.viberoots"/);
  assert.match(seedSource, /"\$out\/\.viberoots\/workspace\/codex-test-logs"/);
  assert.match(seedSource, /"\$out\/build-tools\/tmp"/);
  assert.match(seedSource, /"\$out\/viberoots\/\.viberoots"/);
  assert.match(seedStagingSource, /isGeneratedRepoStateRelPath/);
  assert.match(seedStagingSource, /hasGeneratedRepoState/);
  assert.match(seedCopySource, /removeGeneratedRepoState/);
  assert.match(seedStoreSource, /isGeneratedRepoStateRelPath/);
  assert.match(seedStoreSource, /if \(isGeneratedRepoStateRelPath\(rel\)\) return false/);
  assert.match(rsyncSource, /\/\.viberoots\/buck/);
  assert.match(rsyncSource, /\/\.viberoots\/codex-logs/);
  assert.match(rsyncSource, /\/\.viberoots\/workspace\/\.viberoots/);
  assert.match(rsyncSource, /\/\.viberoots\/workspace\/codex-test-logs/);
  assert.match(rsyncSource, /\/build-tools\/tmp/);
  assert.match(rsyncSource, /"prelude"/);
  assert.match(rsyncSource, /"patches"/);
  assert.match(rsyncSource, /extractedToolRoots\.has\(r\)/);
});

test("verify seed remote-ready manifest records explicit cache artifact path", async () => {
  const root = await mktemp("verify-seed-manifest-root-");
  const manifest = await writeVerifySeedRemoteManifest({
    root,
    seedPath: "/nix/store/example-test-seed",
  });
  const parsed = JSON.parse(await fsp.readFile(manifest, "utf8"));
  assert.equal(parsed.kind, "verify-seed-remote-ready");
  assert.equal(parsed.seedPath, "/nix/store/example-test-seed");
  assert.equal(parsed.cacheManifest.storePath, "/nix/store/example-test-seed");
});

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

test("verify seed staging publishes copy-ready writable shared stages", async () => {
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

  assert.notEqual(rootMode & 0o200, 0);
  assert.notEqual(flakeMode & 0o200, 0);
  if (process.platform === "darwin") {
    await fsp.stat(path.join(staged, ".metadata_never_index"));
  }
  await assert.rejects(fsp.access(path.join(staged, ".seed-store-writable")));
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
    assert.match(source, /\.seed-store-prepared-v5/);
    assert.doesNotMatch(source, /\.seed-store-prepared-v4/);
    assert.doesNotMatch(source, /\.seed-store-prepared-v3/);
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
  assert.match(seedCopySource, /\.seed-store-prepared-v5/);
  assert.match(seedCopySource, /repair_permissions = sys\.argv\[3\] == "1"/);
});
