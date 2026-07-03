#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { shouldPrepareVerifySeedForRequestedTargets } from "../../dev/verify/seed";
import { verifySeedBuildArgs } from "../../dev/verify/seed-build";
import { writeVerifySeedRemoteManifest } from "../../dev/verify/seed-manifest";
import { mktemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readRepoFile(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

test("verify seed build policy defaults to full-suite only", () => {
  assert.equal(shouldPrepareVerifySeedForRequestedTargets([], {}), false);
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

test("verify seed build args use active remote viberoots source when no submodule exists", async () => {
  const root = await mktemp("verify-seed-remote-source-");
  const source = await mktemp("verify-seed-remote-source-viberoots-");
  try {
    await fsp.mkdir(path.join(root, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(path.join(source, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    const args = verifySeedBuildArgs({
      root,
      mode: "remote-ready",
      env: { VIBEROOTS_ROOT: source },
    });
    assert.deepEqual(
      args.slice(args.indexOf("--override-input"), args.indexOf("--override-input") + 3),
      ["--override-input", "viberoots", `path:${source}`],
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(source, { recursive: true, force: true });
  }
});

test("verify seed build args omit missing submodule override in remote consumers", async () => {
  const root = await mktemp("verify-seed-no-submodule-");
  try {
    const args = verifySeedBuildArgs({ root, mode: "remote-ready", env: {} });
    assert.equal(args.includes("--override-input"), false);
    assert.equal(args.includes(`path:${root}/viberoots`), false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
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
  assert.match(source, /"\.viberoots"/);
  assert.match(source, /builtins\.any \(d: rel == "viberoots\/\$\{d\}"/);
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
