#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { handleNonDefaultImporter } from "../../dev/update-pnpm-hash/nondefault";
import {
  readSharedHashCache,
  readVerifiedMarker,
} from "../../dev/update-pnpm-hash/verified-marker";

async function writeDemoImporter(repoRoot: string, lockfileRel: string): Promise<void> {
  await fsp.mkdir(path.join(repoRoot, "projects", "apps", "demo"), { recursive: true });
  await fsp.writeFile(path.join(repoRoot, "projects", "node-modules.hashes.json"), "{}\n", "utf8");
  await fsp.writeFile(
    path.join(repoRoot, "projects", "apps", "demo", "package.json"),
    '{"scripts":{}}\n',
    "utf8",
  );
  await fsp.writeFile(
    path.join(repoRoot, lockfileRel),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "  .: {}",
      "",
    ].join("\n"),
    "utf8",
  );
}

test("non-default stale marker reuses prior fixed hash suggestion from shared cache", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-stale-marker-cache-"));
  const prevRepoRoot = process.env.REPO_ROOT;
  const prevCwd = process.cwd();
  const hashValue = "sha256-1111111111111111111111111111111111111111111=";
  const builderFingerprint = `builder-${path.basename(repoRoot)}`;
  const lockHash = `lock-${path.basename(repoRoot)}`;
  const key = "projects/apps/demo/pnpm-lock.yaml";
  const markerPath = path.join(repoRoot, "buck-out", "tmp", "pnpm-store-verified.demo.json");
  const fixedPhases: string[] = [];
  let prepareCount = 0;

  process.env.REPO_ROOT = repoRoot;
  process.chdir(repoRoot);
  try {
    await writeDemoImporter(repoRoot, key);
    const runFixedBuild = async (phaseLabel: string) => {
      fixedPhases.push(phaseLabel);
      const rawHashes = await fsp.readFile(
        path.join(repoRoot, "projects", "node-modules.hashes.json"),
        "utf8",
      );
      const currentHash = (JSON.parse(rawHashes) as Record<string, string>)[key] || "";
      if (phaseLabel.includes("fixed-build-after-hash") || currentHash === hashValue) {
        return { ok: true, output: "" };
      }
      return { ok: false, output: `got: ${hashValue}` };
    };
    const runUnfixedBuild = async () => {
      throw new Error("stale marker cache test should not run unfixed build");
    };
    const prepareExactStore = async () => {
      prepareCount++;
    };

    assert.equal(
      await handleNonDefaultImporter({
        importer: "projects/apps/demo",
        key,
        repoRoot,
        builderFingerprint,
        storeAttr: "pnpm-store.projects-apps-demo",
        unfixedAttr: "pnpm-store-unfixed.projects-apps-demo",
        timeoutSec: "600",
        force: false,
        markerPath,
        hasValidExistingHash: false,
        existingHash: "",
        existingLockHash: lockHash,
        existingMarker: null,
        runFixedBuild,
        runUnfixedBuild,
        prepareExactStore,
      }),
      true,
    );
    assert.equal(
      await handleNonDefaultImporter({
        importer: "projects/apps/demo",
        key,
        repoRoot,
        builderFingerprint,
        storeAttr: "pnpm-store.projects-apps-demo",
        unfixedAttr: "pnpm-store-unfixed.projects-apps-demo",
        timeoutSec: "600",
        force: false,
        markerPath,
        hasValidExistingHash: true,
        existingHash: hashValue,
        existingLockHash: lockHash,
        existingMarker: {
          importer: "projects/apps/demo",
          lockfile: key,
          lockHash,
          hashValue,
          builderFingerprint: "old-builder",
        },
        acceptedBuilderFingerprints: [builderFingerprint],
        runFixedBuild,
        runUnfixedBuild,
        prepareExactStore,
      }),
      true,
    );

    assert.deepEqual(fixedPhases, [
      "importer=projects/apps/demo step=fixed-build attr=pnpm-store.projects-apps-demo",
      "importer=projects/apps/demo step=fixed-build-after-hash attr=pnpm-store.projects-apps-demo",
      "importer=projects/apps/demo step=shared-hash-cache attr=pnpm-store.projects-apps-demo",
    ]);
    assert.equal(prepareCount, 2);
    assert.equal(await readSharedHashCache({ repoRoot, builderFingerprint, lockHash }), hashValue);
    const marker = await readVerifiedMarker(markerPath);
    assert.equal(marker?.builderFingerprint, builderFingerprint);
    assert.equal(marker?.hashValue, hashValue);
  } finally {
    process.chdir(prevCwd);
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});
