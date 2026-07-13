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

test("withHiddenNodeModules moves existing node_modules outside importer source scans", async () => {
  await withTempImporter("pnpm-node-modules-hidden-workspace", async (repo) => {
    await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
    const importer = path.join(repo, "projects", "apps", "demo");
    await fsp.mkdir(path.join(importer, "node_modules"), { recursive: true });
    await fsp.writeFile(path.join(importer, "node_modules", "kept.txt"), "kept\n");

    await withHiddenNodeModules(importer, async () => {
      await assert.rejects(fsp.lstat(path.join(importer, "node_modules")));
      await assert.rejects(fsp.lstat(path.join(importer, ".node_modules.lockfile-guard")));

      const hiddenRoot = path.join(repo, ".viberoots", "workspace", "node-modules-hidden");
      const hiddenEntries = await fsp.readdir(hiddenRoot);
      assert.equal(hiddenEntries.length, 1);
      assert.match(hiddenEntries[0], /^projects_apps_demo\./);
      assert.equal(
        await fsp.readFile(path.join(hiddenRoot, hiddenEntries[0], "kept.txt"), "utf8"),
        "kept\n",
      );
    });

    assert.equal(
      await fsp.readFile(path.join(importer, "node_modules", "kept.txt"), "utf8"),
      "kept\n",
    );
    assert.deepEqual(
      await fsp.readdir(path.join(repo, ".viberoots", "workspace", "node-modules-hidden")),
      [],
    );
  });
});

test("withHiddenNodeModules moves symlinked node_modules outside importer source scans", async () => {
  await withTempImporter("pnpm-node-modules-symlink", async (repo) => {
    await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
    const importer = path.join(repo, "projects", "apps", "demo");
    const storeNodeModules = path.join(repo, "store", "node_modules");
    await fsp.mkdir(storeNodeModules, { recursive: true });
    await fsp.mkdir(importer, { recursive: true });
    await fsp.symlink(storeNodeModules, path.join(importer, "node_modules"));

    await withHiddenNodeModules(importer, async () => {
      await assert.rejects(fsp.lstat(path.join(importer, "node_modules")));
      const hiddenRoot = path.join(repo, ".viberoots", "workspace", "node-modules-hidden");
      const hiddenEntries = await fsp.readdir(hiddenRoot);
      assert.equal(hiddenEntries.length, 1);
      const hiddenLink = path.join(hiddenRoot, hiddenEntries[0]);
      const stat = await fsp.lstat(hiddenLink);
      assert.equal(stat.isSymbolicLink(), true);
      assert.equal(await fsp.readlink(hiddenLink), storeNodeModules);
    });

    const stat = await fsp.lstat(path.join(importer, "node_modules"));
    assert.equal(stat.isSymbolicLink(), true);
    assert.equal(await fsp.readlink(path.join(importer, "node_modules")), storeNodeModules);
  });
});
