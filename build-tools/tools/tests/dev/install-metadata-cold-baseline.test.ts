#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  glueBaselineHasCommittedAuthority,
  glueFingerprintFresh,
  glueFreshnessOutputs,
} from "../../dev/install/glue-freshness";
import { assertCppTrackedMetadataReady } from "../../dev/install/metadata-mode";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { runInScratchTemp } from "../lib/test-helpers/run-in-temp";

const execFileAsync = promisify(execFile);
const outputs = [
  "build-tools/lang/auto_map.bzl",
  "build-tools/lang/importer_roots.bzl",
  "build-tools/lang/nix_attr_aliases.bzl",
  "build-tools/tools/nix/langs.nix",
];

async function writeFixture(root: string): Promise<void> {
  for (const rel of outputs) {
    await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fsp.writeFile(path.join(root, rel), "generated\n");
  }
  const langsJson = path.join(root, "build-tools/tools/nix/langs.json");
  await fsp.writeFile(langsJson, JSON.stringify({ enabled: ["cpp"] }));
  const zxInit = path.join(root, "build-tools/tools/dev/zx-init.mjs");
  await fsp.mkdir(path.dirname(zxInit), { recursive: true });
  await fsp.writeFile(zxInit, "export {};\n");
}

async function commitAll(git: string, root: string, message: string): Promise<void> {
  await execFileAsync(git, ["add", "."], { cwd: root });
  await execFileAsync(
    git,
    ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", message],
    { cwd: root },
  );
}

test("cold C++ baseline authority requires clean tracked inputs", async () => {
  await runInScratchTemp("install-cpp-cold-authority", async (root) => {
    const git = ensureNixStoreToolPathSync("git");
    await fsp.rm(path.join(root, ".viberoots/current"), { force: true });
    await writeFixture(root);
    for (const rel of glueFreshnessOutputs(root)) {
      await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fsp.writeFile(path.join(root, rel), "generated\n");
    }
    await fsp.writeFile(path.join(root, ".gitignore"), ".viberoots/\n");
    await execFileAsync(git, ["init", "-q"], { cwd: root });
    await commitAll(git, root, "fixture");

    assert.equal(await glueBaselineHasCommittedAuthority(root, outputs), true);
    await assertCppTrackedMetadataReady(root);
    await fsp.access(path.join(root, ".viberoots/workspace/buck/prebuild-fingerprint.json"));
    assert.equal((await execFileAsync(git, ["diff", "--name-only"], { cwd: root })).stdout, "");

    const langsJson = path.join(root, "build-tools/tools/nix/langs.json");
    await fsp.writeFile(langsJson, JSON.stringify({ enabled: ["cpp"], changed: true }));
    assert.equal(await glueBaselineHasCommittedAuthority(root, outputs), false);
  });
});

test("cold C++ baseline authority rejects untracked relevant inputs", async () => {
  await runInScratchTemp("install-cpp-cold-untracked", async (root) => {
    const git = ensureNixStoreToolPathSync("git");
    await writeFixture(root);
    await execFileAsync(git, ["init", "-q"], { cwd: root });
    await execFileAsync(git, ["add", ...outputs], { cwd: root });
    await execFileAsync(
      git,
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "outputs"],
      { cwd: root },
    );

    assert.equal(await glueBaselineHasCommittedAuthority(root, outputs), false);
  });
});

test("cold C++ baseline authority rejects deleted tracked inputs without a fingerprint", async () => {
  await runInScratchTemp("install-cpp-cold-deleted", async (root) => {
    const git = ensureNixStoreToolPathSync("git");
    await writeFixture(root);
    const targets = path.join(root, "projects/demo/TARGETS");
    await fsp.mkdir(path.dirname(targets), { recursive: true });
    await fsp.writeFile(targets, "# tracked relevant input\n");
    await execFileAsync(git, ["init", "-q"], { cwd: root });
    await commitAll(git, root, "baseline with target");
    await fsp.rm(targets);

    assert.equal(await glueBaselineHasCommittedAuthority(root, outputs), false);
    assert.equal((await glueFingerprintFresh(root)).reason, "uncommitted-or-deleted-baseline");
    await assert.rejects(assertCppTrackedMetadataReady(root), /uncommitted-or-deleted-baseline/);
    await assert.rejects(
      fsp.access(path.join(root, ".viberoots/workspace/buck/prebuild-fingerprint.json")),
    );
  });
});

test("cold C++ baseline authority rejects a parent gitlink mismatch", async () => {
  await runInScratchTemp("install-cpp-cold-gitlink", async (root) => {
    const git = ensureNixStoreToolPathSync("git");
    const child = path.join(root, "viberoots");
    await fsp.mkdir(child);
    await writeFixture(child);
    await execFileAsync(git, ["init", "-q"], { cwd: child });
    await commitAll(git, child, "child baseline");

    await execFileAsync(git, ["init", "-q"], { cwd: root });
    await fsp.writeFile(path.join(root, ".gitignore"), ".viberoots/workspace/\n");
    await fsp.mkdir(path.join(root, ".viberoots"));
    await fsp.symlink("../viberoots", path.join(root, ".viberoots", "current"));
    await commitAll(git, root, "parent baseline");
    const childOutputs = outputs.map((rel) => path.join(child, rel));
    assert.equal(await glueBaselineHasCommittedAuthority(root, childOutputs), true);

    await fsp.writeFile(
      path.join(child, "build-tools/tools/nix/langs.json"),
      JSON.stringify({ enabled: ["cpp"], changed: true }),
    );
    await commitAll(git, child, "child moved");
    assert.equal(await glueBaselineHasCommittedAuthority(root, childOutputs), false);
  });
});
