#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { withHiddenNodeModules } from "../../lib/pnpm-node-modules-guard";

async function withTempImporter(name: string, fn: (dir: string) => Promise<void>) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("withHiddenNodeModules removes node_modules created by the guarded command", async () => {
  await withTempImporter("pnpm-node-modules-created", async (importer) => {
    await withHiddenNodeModules(importer, async () => {
      await fsp.mkdir(path.join(importer, "node_modules"), { recursive: true });
      await fsp.writeFile(path.join(importer, "node_modules", "created.txt"), "created\n");
    });

    await assert.rejects(fsp.lstat(path.join(importer, "node_modules")));
  });
});

test("withHiddenNodeModules restores pre-existing node_modules after cleanup", async () => {
  await withTempImporter("pnpm-node-modules-restored", async (importer) => {
    await fsp.mkdir(path.join(importer, "node_modules"), { recursive: true });
    await fsp.writeFile(path.join(importer, "node_modules", "kept.txt"), "kept\n");

    await withHiddenNodeModules(importer, async () => {
      await fsp.mkdir(path.join(importer, "node_modules"), { recursive: true });
      await fsp.writeFile(path.join(importer, "node_modules", "created.txt"), "created\n");
    });

    assert.equal(
      await fsp.readFile(path.join(importer, "node_modules", "kept.txt"), "utf8"),
      "kept\n",
    );
    await assert.rejects(fsp.lstat(path.join(importer, "node_modules", "created.txt")));
  });
});
