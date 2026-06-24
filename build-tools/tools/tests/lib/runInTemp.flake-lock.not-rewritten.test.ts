#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("runInTemp rewrites only the local viberoots lock path to its active temp source", async () => {
  const repoRoot = process.cwd();
  const lockPath = (
    await Promise.all(
      [
        path.join(repoRoot, ".viberoots", "workspace", "flake.lock"),
        path.join(path.dirname(repoRoot), ".viberoots", "workspace", "flake.lock"),
        path.join(repoRoot, "flake.lock"),
      ].map(async (candidate) => {
        try {
          await fsp.access(candidate);
          return candidate;
        } catch {
          return "";
        }
      }),
    )
  ).find(Boolean);
  assert.ok(lockPath, "expected a source workspace flake.lock");
  const original = JSON.parse(await fsp.readFile(lockPath, "utf8"));

  await runInTemp("flake-lock-no-rewrite", async (tmp) => {
    const expectedInputRoot = process.env.VBR_TEST_SEED_STORE_PATH
      ? await fsp
          .realpath(path.join(process.env.VBR_TEST_SEED_STORE_PATH, "viberoots"))
          .catch(() => path.join(process.env.VBR_TEST_SEED_STORE_PATH!, "viberoots"))
      : path.join(tmp, "viberoots");
    const tmpLockPath = path.join(tmp, ".viberoots", "workspace", "flake.lock");
    const tmpLock = JSON.parse(await fsp.readFile(tmpLockPath, "utf8"));
    const inputName = tmpLock.nodes.root.inputs.viberoots;
    assert.equal(inputName, original.nodes.root.inputs.viberoots);
    assert.equal(tmpLock.nodes[inputName].locked.type, "path");
    assert.equal(tmpLock.nodes[inputName].locked.path, expectedInputRoot);
    assert.match(String(tmpLock.nodes[inputName].locked.narHash || ""), /^sha256-/);
    assert.equal(tmpLock.nodes[inputName].original.type, "path");
    assert.equal(tmpLock.nodes[inputName].original.path, expectedInputRoot);

    const originalWithoutViberoots = structuredClone(original);
    const tmpWithoutViberoots = structuredClone(tmpLock);
    delete originalWithoutViberoots.nodes[inputName];
    delete tmpWithoutViberoots.nodes[inputName];
    assert.deepEqual(tmpWithoutViberoots, originalWithoutViberoots);
  });
});
