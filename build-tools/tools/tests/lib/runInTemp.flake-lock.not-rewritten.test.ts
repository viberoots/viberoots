#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";
import { isGeneratedFilteredViberootsInputPath } from "./test-helpers/run-in-temp/filtered-inputs";
import { rewriteViberootsLockEntry } from "./test-helpers/run-in-temp/flake-rewrite";

test("runInTemp replaces a prior immutable viberoots source without accepting other store paths", () => {
  const priorSource = `/nix/store/${"1".repeat(32)}-source`;
  const activeSource = `/nix/store/${"2".repeat(32)}-source`;
  const entry = { type: "path", path: priorSource, narHash: "sha256-old" };

  assert.equal(rewriteViberootsLockEntry(entry, activeSource, { narHash: "sha256-current" }), true);
  assert.deepEqual(entry, {
    type: "path",
    path: activeSource,
    narHash: "sha256-current",
  });
  assert.equal(
    rewriteViberootsLockEntry(
      { type: "path", path: `/nix/store/${"3".repeat(32)}-unrelated` },
      activeSource,
    ),
    false,
  );
});

test("runInTemp rewrites only the local viberoots lock path to its active temp source", async () => {
  await runInTemp("flake-lock-no-rewrite", async (tmp) => {
    assert.ok(
      process.env.VIBEROOTS_FLAKE_INPUT_ROOT,
      "expected runInTemp to provide VIBEROOTS_FLAKE_INPUT_ROOT",
    );
    const expectedInputRoot = await fsp.realpath(process.env.VIBEROOTS_FLAKE_INPUT_ROOT);
    assert.match(expectedInputRoot, /^\/nix\/store\/[a-z0-9]{32}-source$/);
    const tmpLocks = (
      await Promise.all(
        [path.join(tmp, ".viberoots", "workspace", "flake.lock"), path.join(tmp, "flake.lock")].map(
          async (candidate) => {
            const lock = JSON.parse(await fsp.readFile(candidate, "utf8").catch(() => "{}"));
            return Object.keys(lock).length > 0 ? lock : null;
          },
        ),
      )
    ).filter(Boolean);
    assert.ok(tmpLocks.length > 0, "expected at least one temp flake lock");
    for (const lock of tmpLocks) {
      const inputName = lock?.nodes?.root?.inputs?.viberoots;
      if (typeof inputName !== "string") continue;
      const lockedPath = String(lock.nodes[inputName]?.locked?.path || "");
      assert.ok(
        isGeneratedFilteredViberootsInputPath(lockedPath) || lockedPath === expectedInputRoot,
        `expected authoritative filtered input lock paths to be canonical local or immutable store paths: ${lockedPath}`,
      );
    }
    const tmpLock = tmpLocks.find((lock) => lock?.nodes?.root?.inputs?.viberoots);
    if (!tmpLock) return;
    const inputName = tmpLock.nodes.root.inputs.viberoots;
    assert.equal(typeof inputName, "string");
    assert.equal(tmpLock.nodes[inputName].locked.type, "path");
    const immutableInputRoot = tmpLock.nodes[inputName].locked.path;
    assert.ok(
      immutableInputRoot === expectedInputRoot ||
        isGeneratedFilteredViberootsInputPath(immutableInputRoot),
    );
    if (immutableInputRoot === expectedInputRoot) {
      assert.match(String(tmpLock.nodes[inputName].locked.narHash || ""), /^sha256-/);
    }
    assert.equal(tmpLock.nodes[inputName].original.type, "path");
    assert.equal(tmpLock.nodes[inputName].original.path, immutableInputRoot);
  });
});
