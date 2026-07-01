#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { isGeneratedRepoStateRelPath } from "../../dev/verify/generated-state-excludes";

async function readRepoFile(relativePath: string): Promise<string> {
  for (const candidate of [relativePath, path.join("viberoots", relativePath)]) {
    try {
      return await fsp.readFile(candidate, "utf8");
    } catch {}
  }
  return await fsp.readFile(relativePath, "utf8");
}

const generatedStatePaths = [
  ".DS_Store",
  ".codex-logs/session.log",
  ".codex-pr11-verify.log",
  ".full-test-output.log",
  ".patch-sessions.json",
  ".viberoots/workspace/buck/graph.json",
  "viberoots/.DS_Store",
  "viberoots/.codex-logs/session.log",
  "viberoots/.codex-pr11-verify.log",
  "viberoots/.direnv/flake-profile.rc",
  "viberoots/.nix-gcroots/devshell",
  "viberoots/.patch-sessions.json",
  "viberoots/.viberoots/workspace/buck/unified-pnpm-store/path",
  "viberoots/buck-out/v2/cache",
  "viberoots/build-tools/tmp/scratch",
  "viberoots/node_modules/.bin/tool",
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
  for (const needle of [
    ".DS_Store",
    ".codex-logs",
    ".full-test-output.log",
    ".patch-sessions.json",
    "viberoots/.DS_Store",
    "viberoots/.codex-",
    "viberoots/build-tools/tmp",
  ]) {
    assert.match(filterSource, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(seedSource, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
