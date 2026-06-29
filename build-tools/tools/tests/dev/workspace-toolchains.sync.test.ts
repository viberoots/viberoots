#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { toolchainBzlPaths } from "../../dev/workspace-toolchains";

async function writeFile(file: string, data: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, data, "utf8");
}

test("workspace toolchain sync preserves mtimes for unchanged files", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "workspace-toolchains-"));
  try {
    await writeFile(path.join(root, "viberoots", "build-tools", "tools", "dev", "zx-init.mjs"), "");
    await writeFile(path.join(root, "viberoots", "toolchains", "TARGETS"), "# targets\n");
    await writeFile(path.join(root, "viberoots", "toolchains", "python.bzl"), "# python\n");
    await writeFile(path.join(root, "viberoots", "toolchains", "nested", "defs.bzl"), "# defs\n");
    await fsp.mkdir(path.join(root, ".viberoots", "workspace"), { recursive: true });

    const paths = await toolchainBzlPaths(root);
    assert.ok(
      paths.includes(
        path.join(root, ".viberoots", "workspace", "toolchains", "toolchain_paths.bzl"),
      ),
    );

    const copied = path.join(root, ".viberoots", "workspace", "toolchains", "python.bzl");
    const nested = path.join(root, ".viberoots", "workspace", "toolchains", "nested", "defs.bzl");
    const firstCopied = (await fsp.stat(copied)).mtimeMs;
    const firstNested = (await fsp.stat(nested)).mtimeMs;

    await toolchainBzlPaths(root);

    assert.equal((await fsp.stat(copied)).mtimeMs, firstCopied);
    assert.equal((await fsp.stat(nested)).mtimeMs, firstNested);
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("workspace toolchain sync removes stale generated files", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "workspace-toolchains-stale-"));
  try {
    await writeFile(path.join(root, "viberoots", "build-tools", "tools", "dev", "zx-init.mjs"), "");
    await writeFile(path.join(root, "viberoots", "toolchains", "TARGETS"), "# targets\n");
    await fsp.mkdir(path.join(root, ".viberoots", "workspace", "toolchains"), { recursive: true });
    await writeFile(
      path.join(root, ".viberoots", "workspace", "toolchains", "stale.bzl"),
      "# stale\n",
    );
    await writeFile(
      path.join(root, ".viberoots", "workspace", "toolchains", ".metadata_never_index"),
      "",
    );

    await toolchainBzlPaths(root);

    await assert.rejects(
      fsp.stat(path.join(root, ".viberoots", "workspace", "toolchains", "stale.bzl")),
    );
    assert.equal(
      (
        await fsp.stat(
          path.join(root, ".viberoots", "workspace", "toolchains", ".metadata_never_index"),
        )
      ).isFile(),
      true,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
