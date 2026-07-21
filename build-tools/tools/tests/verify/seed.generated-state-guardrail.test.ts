#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { isGeneratedRepoStateRelPath } from "../../lib/generated-repo-state";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readRepoFile(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

const generatedStatePaths = [
  ".DS_Store",
  ".codex-logs/session.log",
  ".codex-focused-verify.log",
  ".full-test-output.log",
  ".patch-sessions.json",
  "viberoots-flake-input/.nix-gcroots/devshell",
  ".viberoots/workspace/backups/backup.json",
  ".viberoots/workspace/buck/graph.json",
  ".viberoots/workspace/cache/nix-tarballs",
  ".viberoots/workspace/install-cache/state.json",
  ".viberoots/workspace/nix-xdg-cache/nix/tarball-cache-v2",
  ".viberoots/workspace/node/bin/node",
  ".viberoots/workspace/pr-logs/source-snapshot.log",
  ".viberoots/workspace/viberoots-flake-input/.nix-gcroots/devshell",
  ".viberoots/workspace/xdg-cache/nix/tarball-cache-v2",
  "build-tools/tools/dev/toolchain-paths.json",
  "toolchains/toolchain_paths.bzl",
  "viberoots/.DS_Store",
  "viberoots/.codex-logs/session.log",
  "viberoots/.codex-focused-verify.log",
  "viberoots/.direnv/flake-profile.rc",
  "viberoots/.nix-gcroots/devshell",
  "viberoots/.patch-sessions.json",
  "viberoots/.viberoots/workspace/buck/unified-pnpm-store/path",
  "viberoots/backups/snapshot.json",
  "viberoots/buck-out/v2/cache",
  "viberoots/build-tools/tmp/scratch",
  "viberoots/build-tools/tools/dev/toolchain-paths.json",
  "viberoots/cache/pnpm/blob",
  "viberoots/codex-test-logs/focused.log",
  "viberoots/install-cache/state.json",
  "viberoots/nix-xdg-cache/nix/tarball-cache-v2",
  "viberoots/node_modules/.bin/tool",
  "viberoots/pr-logs/run.log",
  "viberoots/toolchains/toolchain_paths.bzl",
  "viberoots/xdg-cache/pnpm/blob",
];

test("verify seed generated-state guardrail covers split-root noise", () => {
  for (const rel of generatedStatePaths) {
    assert.equal(isGeneratedRepoStateRelPath(rel), true, rel);
  }
});

test("verify seed nix filters mirror split-root generated-state guardrail", async () => {
  const filterSource = await readRepoFile(
    "build-tools/tools/nix/flake/packages/filter-seed-repo.nix",
  );
  const seedSource = await readRepoFile("build-tools/tools/nix/flake/packages/test-seed.nix");
  const sharedLiteralNeedles = [
    ".DS_Store",
    ".codex-logs",
    ".full-test-output.log",
    ".patch-sessions.json",
    "viberoots-flake-input",
    ".viberoots/workspace/backups",
    ".viberoots/workspace/buck",
    ".viberoots/workspace/cache",
    ".viberoots/workspace/install-cache",
    ".viberoots/workspace/nix-xdg-cache",
    ".viberoots/workspace/node",
    ".viberoots/workspace/pr-logs",
    ".viberoots/workspace/viberoots-flake-input",
    ".viberoots/workspace/xdg-cache",
    "viberoots/.DS_Store",
    "viberoots/.codex-",
    "viberoots/build-tools/tmp",
    "toolchain-paths.json",
    "toolchain_paths.bzl",
  ];
  for (const needle of sharedLiteralNeedles) {
    assert.match(filterSource, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(seedSource, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const viberootsGeneratedRoots = [
    "backups",
    "cache",
    "codex-test-logs",
    "install-cache",
    "nix-xdg-cache",
    "pr-logs",
    "xdg-cache",
  ];
  assert.match(filterSource, /viberootsGeneratedRoots = \[/);
  assert.match(filterSource, /rel == "viberoots\/\$\{d\}"/);
  for (const generatedRoot of viberootsGeneratedRoots) {
    assert.match(filterSource, new RegExp(`"${generatedRoot}"`));
    assert.match(seedSource, new RegExp(`viberoots/${generatedRoot}`));
  }
});

test("verify seed nix filter defaults to explicit root allowlist", async () => {
  const filterSource = await readRepoFile(
    "build-tools/tools/nix/flake/packages/filter-seed-repo.nix",
  );
  assert.match(filterSource, /seedRootDirs = \[/);
  assert.match(filterSource, /seedRootFiles = \[/);
  assert.match(filterSource, /lib\.elem base seedRootFiles/);
  assert.doesNotMatch(filterSource, /isRootFile rel && !isExcludedRootFile base\) \|\|/);
  for (const required of [
    '"flake.nix"',
    '"flake.lock"',
    '"package.json"',
    '"pnpm-lock.yaml"',
    '".buckconfig"',
    '"TARGETS"',
    '"build-tools"',
    '"viberoots"',
  ]) {
    assert.match(filterSource, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
