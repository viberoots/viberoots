#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

async function sourceSnapshotActionCommand(target: string): Promise<string> {
  const res =
    await $`buck2 --isolation-dir ${inheritedBuckIsolation("source_snapshot_aquery")} aquery --target-platforms prelude//platforms:default 'kind(run, deps(${target}))' --output-attribute cmd --output-format starlark`;
  return String(res.stdout || "");
}

async function sourceSnapshotActions(target: string): Promise<string> {
  const res =
    await $`buck2 --isolation-dir ${inheritedBuckIsolation("source_snapshot_actions")} aquery --target-platforms prelude//platforms:default 'deps(${target})' --output-format starlark`;
  return String(res.stdout || "");
}

test("source snapshot includes declared source and excludes mutable local directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "source-snapshot-"));
  const out = path.join(root, "out");
  const manifest = path.join(root, "manifest.json");
  await write(path.join(root, "flake.nix"), "{}\n");
  await write(path.join(root, "flake.lock"), "{}\n");
  await write(path.join(root, "TARGETS"), "filegroup(name='all')\n");
  await write(path.join(root, "build-tools", "lang", "defs.bzl"), "X = 1\n");
  await write(path.join(root, DEFAULT_GRAPH_PATH), "[]\n");
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
  })`zx-wrapper build-tools/tools/dev/source-snapshot.ts --workspace-root ${root} --out ${out} --manifest ${manifest} --graph ${path.join(root, DEFAULT_GRAPH_PATH)}`;

  for (const rel of [
    "flake.nix",
    "flake.lock",
    "TARGETS",
    "build-tools/lang/defs.bzl",
    DEFAULT_GRAPH_PATH,
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
  assert.equal(data.graphPathInSnapshot, DEFAULT_GRAPH_PATH);
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

test("source_snapshot action uses declared zx-wrapper runner without flake or hashbang invocation", async () => {
  const command = await sourceSnapshotActionCommand(
    "//build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_ready_source_snapshot",
  );

  assert.match(
    command,
    /cmd = \[[^,\]]*build-tools\/tools\/dev\/__source-snapshot-zx-wrapper__\/source-snapshot-zx-wrapper, --import, \.\/[^,\]]*build-tools\/tools\/dev\/__zx-init\.mjs__\/zx-init\.mjs, \.\/[^,\]]*build-tools\/tools\/dev\/__source-snapshot\.ts__\/source-snapshot\.ts,/,
  );
  assert.doesNotMatch(command, /nix, run|path:\.#zx-wrapper/);
  assert.doesNotMatch(command, /cmd = \[[^,\]]*source-snapshot\.ts,/);
  assert.doesNotMatch(command, /\/nix\/store\/[^,\]]+-zx-wrapper\/bin\/zx-wrapper/);
  assert.doesNotMatch(command, /\bnode\b|command -v node|\[zx-wrapper,/);
  assert.match(
    command,
    /--graph, build-tools\/tools\/tests\/remote-exec\/wrapper-fixtures\/fixture\.txt/,
  );
  assert.match(
    command,
    /--file, fixture\.txt, build-tools\/tools\/tests\/remote-exec\/wrapper-fixtures\/fixture\.txt/,
  );
});

test("source_snapshot runtime is a declared Buck tool output", async () => {
  const actions = await sourceSnapshotActions(
    "//build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_ready_source_snapshot",
  );

  assert.match(actions, /identifier = source-snapshot-zx-wrapper,\s+kind = write,/);
  assert.match(actions, /\/nix\/store\/[^,\n]+-zx-wrapper\/bin\/zx-wrapper/);
  assert.match(
    actions,
    /cmd = \[[^,\]]*build-tools\/tools\/dev\/__source-snapshot-zx-wrapper__\/source-snapshot-zx-wrapper,/,
  );
});

test("source_snapshot rule rejects ambient workspace snapshots", async () => {
  await runInTemp("source-snapshot-rule-empty-srcs", async (tmp, $) => {
    const dir = path.join(tmp, "tmp", "source_snapshot_rule_empty_srcs");
    await fs.mkdir(dir, { recursive: true });
    await write(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/lang:source_snapshot.bzl", "source_snapshot")',
        'source_snapshot(name = "ambient", srcs = [], graph = "TARGETS")',
      ].join("\n") + "\n",
    );
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("source_snapshot_empty_srcs")} build //tmp/source_snapshot_rule_empty_srcs:ambient`;
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /source_snapshot requires explicit declared srcs/);
  });
});
