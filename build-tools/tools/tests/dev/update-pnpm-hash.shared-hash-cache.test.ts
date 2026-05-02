#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { handleNonDefaultImporter } from "../../dev/update-pnpm-hash/nondefault.ts";
import {
  readSharedHashCache,
  writeSharedHashCache,
} from "../../dev/update-pnpm-hash/verified-marker.ts";

test("shared pnpm-store hash cache is keyed by lock hash and builder fingerprint", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-shared-cache-"));
  const prevRepoRoot = process.env.REPO_ROOT;
  process.env.REPO_ROOT = repoRoot;
  try {
    await writeSharedHashCache(repoRoot, {
      lockHash: "lock-a",
      hashValue: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=",
      builderFingerprint: "builder-1",
    });

    assert.equal(
      await readSharedHashCache({
        repoRoot: path.join(repoRoot, "tmp-workspace"),
        builderFingerprint: "builder-1",
        lockHash: "lock-a",
      }),
      "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=",
    );
    assert.equal(
      await readSharedHashCache({
        repoRoot,
        builderFingerprint: "builder-2",
        lockHash: "lock-a",
      }),
      null,
    );
    assert.equal(
      await readSharedHashCache({
        repoRoot,
        builderFingerprint: "builder-1",
        lockHash: "lock-b",
      }),
      null,
    );
  } finally {
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});

test("non-default pnpm-store hash refresh singleflights cold shared-cache misses", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-shared-cache-lock-"));
  const prevRepoRoot = process.env.REPO_ROOT;
  const prevCwd = process.cwd();
  const hashValue = "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=";
  const builderFingerprint = `builder-${path.basename(repoRoot)}`;
  const lockHash = `lock-${path.basename(repoRoot)}`;
  const key = "projects/libs/demo/pnpm-lock.yaml";
  const markerPath = path.join(repoRoot, "buck-out", "tmp", "pnpm-store-verified.demo.json");
  const fixedPhases: string[] = [];

  process.env.REPO_ROOT = repoRoot;
  process.chdir(repoRoot);
  try {
    await fsp.mkdir(path.join(repoRoot, "build-tools", "tools", "nix"), { recursive: true });
    await fsp.writeFile(
      path.join(repoRoot, "build-tools", "tools", "nix", "node-modules.hashes.json"),
      "{}\n",
      "utf8",
    );

    const runOne = async () =>
      await handleNonDefaultImporter({
        importer: "projects/libs/demo",
        key,
        repoRoot,
        builderFingerprint,
        storeAttr: "pnpm-store.projects-libs-demo",
        unfixedAttr: "pnpm-store-unfixed.projects-libs-demo",
        timeoutSec: "600",
        markerPath,
        hasValidExistingHash: false,
        existingHash: "",
        existingLockHash: lockHash,
        existingMarker: null,
        runFixedBuild: async (phaseLabel) => {
          fixedPhases.push(phaseLabel);
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (phaseLabel.includes("fixed-build-after-hash")) {
            return { ok: true, output: "" };
          }
          return { ok: false, output: `got: ${hashValue}` };
        },
        runUnfixedBuild: async () => {
          throw new Error("shared-cache singleflight test should not run unfixed build");
        },
      });

    assert.deepEqual(await Promise.all([runOne(), runOne()]), [true, true]);
    assert.deepEqual(fixedPhases, [
      "importer=projects/libs/demo step=fixed-build attr=pnpm-store.projects-libs-demo",
      "importer=projects/libs/demo step=fixed-build-after-hash attr=pnpm-store.projects-libs-demo",
    ]);
    assert.equal(await readSharedHashCache({ repoRoot, builderFingerprint, lockHash }), hashValue);
  } finally {
    process.chdir(prevCwd);
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});
