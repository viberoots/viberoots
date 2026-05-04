#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pruneNodeModulesHashesJson } from "../../dev/update-pnpm-hash/hashes-json";

test("pruneNodeModulesHashesJson removes stale lockfile keys", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "hashes-prune-"));
  const prevCwd = process.cwd();
  try {
    process.chdir(tmp);
    const hashesPath = path.join("build-tools", "tools", "nix", "node-modules.hashes.json");
    await fsp.mkdir(path.dirname(hashesPath), { recursive: true });
    await fsp.writeFile(
      hashesPath,
      JSON.stringify(
        {
          "pnpm-lock.yaml": "sha256-root",
          "projects/apps/alive/pnpm-lock.yaml": "sha256-alive",
          "projects/apps/deleted/pnpm-lock.yaml": "sha256-deleted",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const removed = await pruneNodeModulesHashesJson([
      "pnpm-lock.yaml",
      "projects/apps/alive/pnpm-lock.yaml",
    ]);
    assert.deepEqual(removed, ["projects/apps/deleted/pnpm-lock.yaml"]);

    const next = JSON.parse(await fsp.readFile(hashesPath, "utf8")) as Record<string, string>;
    assert.deepEqual(Object.keys(next).sort(), [
      "pnpm-lock.yaml",
      "projects/apps/alive/pnpm-lock.yaml",
    ]);
    assert.equal(next["pnpm-lock.yaml"], "sha256-root");
    assert.equal(next["projects/apps/alive/pnpm-lock.yaml"], "sha256-alive");
  } finally {
    process.chdir(prevCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
