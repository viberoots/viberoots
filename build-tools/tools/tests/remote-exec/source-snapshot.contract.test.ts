#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

test("source snapshot includes declared source and excludes mutable local directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "source-snapshot-"));
  const out = path.join(root, "out");
  const manifest = path.join(root, "manifest.json");
  await write(path.join(root, "flake.nix"), "{}\n");
  await write(path.join(root, "flake.lock"), "{}\n");
  await write(path.join(root, "TARGETS"), "filegroup(name='all')\n");
  await write(path.join(root, "build-tools", "lang", "defs.bzl"), "X = 1\n");
  await write(path.join(root, "build-tools", "tools", "buck", "graph.json"), "[]\n");
  await write(path.join(root, "projects", "apps", "demo", "index.ts"), "export {}\n");
  for (const rel of [
    ".git/config",
    ".direnv/cache",
    "node_modules/pkg/index.js",
    "buck-out/log",
    "tmp/local",
  ]) {
    await write(path.join(root, rel), "forbidden\n");
  }

  await $({
    stdio: "pipe",
  })`node --experimental-strip-types build-tools/tools/dev/source-snapshot.ts --workspace-root ${root} --out ${out} --manifest ${manifest} --graph ${path.join(root, "build-tools/tools/buck/graph.json")}`;

  for (const rel of [
    "flake.nix",
    "flake.lock",
    "TARGETS",
    "build-tools/lang/defs.bzl",
    "build-tools/tools/buck/graph.json",
  ]) {
    assert.equal(await fs.readFile(path.join(out, rel), "utf8").then(Boolean), true, rel);
  }
  for (const rel of [
    ".git/config",
    ".direnv/cache",
    "node_modules/pkg/index.js",
    "buck-out/log",
    "tmp/local",
  ]) {
    await assert.rejects(fs.access(path.join(out, rel)), undefined, rel);
  }
  const data = JSON.parse(await fs.readFile(manifest, "utf8"));
  assert.equal(data.schemaVersion, "viberoots.source-snapshot.v1");
  assert.equal(data.ambientWorkspaceRoot, root);
  assert.equal(data.declaredSnapshotRoot, out);
  assert.equal(data.graphPathInSnapshot, "build-tools/tools/buck/graph.json");
});

test("source_snapshot rule builds a declared Buck snapshot artifact", async () => {
  await runInTemp("source-snapshot-rule", async (tmp, $) => {
    const dir = path.join(tmp, "tmp", "source_snapshot_rule");
    await fs.mkdir(dir, { recursive: true });
    await write(path.join(dir, "fixture.txt"), "hello\n");
    await write(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/lang:source_snapshot.bzl", "source_snapshot")',
        'source_snapshot(name = "tiny", srcs = ["fixture.txt", "TARGETS"], graph = "fixture.txt")',
      ].join("\n") + "\n",
    );
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("source_snapshot_rule")} build //tmp/source_snapshot_rule:tiny --show-output`;
    assert.equal(res.exitCode, 0, String(res.stderr || ""));
    assert.match(String(res.stdout || ""), /tiny\.source-snapshot/);
  });
});
