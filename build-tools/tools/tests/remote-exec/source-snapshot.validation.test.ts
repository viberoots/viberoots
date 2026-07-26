#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const viberootsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const validator = path.join(viberootsRoot, "build-tools/tools/dev/validate-source-snapshot.ts");

async function writeManifest(root: string, files: string[]): Promise<string> {
  const manifest = path.join(path.dirname(root), "snapshot.manifest.json");
  await fsp.writeFile(
    manifest,
    JSON.stringify({
      schemaVersion: "viberoots.source-snapshot.v1",
      declaredSnapshotRoot: root,
      graphPathInSnapshot: ".viberoots/workspace/buck/graph.json",
      files,
    }),
  );
  return manifest;
}

test("real Rust snapshot validator rejects absolute and escaping symlink targets", async () => {
  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), "source-snapshot-symlink-"));
  try {
    const root = path.join(fixture, "snapshot");
    const graph = ".viberoots/workspace/buck/graph.json";
    await fsp.mkdir(path.join(root, path.dirname(graph)), { recursive: true });
    await fsp.writeFile(path.join(root, graph), "[]\n");
    const external = path.join(fixture, "external.txt");
    await fsp.writeFile(external, "external\n");

    for (const [target, expected] of [
      [external, /symlink target must be relative/],
      ["../external.txt", /symlink target escapes its root/],
    ] as const) {
      const link = path.join(root, "escape");
      await fsp.rm(link, { force: true });
      await fsp.symlink(target, link);
      const manifest = await writeManifest(root, [graph, "escape"]);
      const result = await $({
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`node --experimental-strip-types ${validator} ${root} ${manifest}`;
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr || result.stdout), expected);
    }
  } finally {
    await fsp.rm(fixture, { recursive: true, force: true });
  }
});

test("real Rust snapshot validator permits internal relative symlinks", async () => {
  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), "source-snapshot-internal-link-"));
  try {
    const root = path.join(fixture, "snapshot");
    const graph = ".viberoots/workspace/buck/graph.json";
    await fsp.mkdir(path.join(root, path.dirname(graph)), { recursive: true });
    await fsp.writeFile(path.join(root, graph), "[]\n");
    await fsp.writeFile(path.join(root, "source.txt"), "source\n");
    await fsp.symlink("source.txt", path.join(root, "internal"));
    const manifest = await writeManifest(root, [graph, "internal", "source.txt"]);
    await $`node --experimental-strip-types ${validator} ${root} ${manifest}`;
  } finally {
    await fsp.rm(fixture, { recursive: true, force: true });
  }
});
