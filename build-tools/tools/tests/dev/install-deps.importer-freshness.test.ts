#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { importerInstallFreshness } from "../../dev/install/importer-freshness";
import { sanitizeName } from "../../dev/install/common";
import { currentVerifiedMarkerFingerprint } from "../../dev/update-pnpm-hash/verified-marker";

const DERIVATION_IDENTITY = `/nix/store/${"a".repeat(32)}-pnpm-store-fixture.drv`;
const FRESHNESS_DEPS = {
  currentDerivationIdentity: async () => DERIVATION_IDENTITY,
};

async function writeFile(filePath: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf8");
}

async function sha256Text(content: string): Promise<string> {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function hashKeyForImporter(importer: string): string {
  return importer === "viberoots" ? "pnpm-lock.yaml" : `${importer}/pnpm-lock.yaml`;
}

async function makeRepo(importer = "projects/apps/app"): Promise<{
  repoRoot: string;
  importer: string;
  lockHash: string;
  cleanup: () => Promise<void>;
}> {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "importer-freshness-"));
  const lockContent = `lockfileVersion: '9.0'\n# ${repoRoot}\n`;
  const lockHash = await sha256Text(lockContent);
  await writeFile(path.join(repoRoot, importer, "pnpm-lock.yaml"), lockContent);
  await writeFile(
    path.join(repoRoot, "projects", "node-modules.hashes.json"),
    JSON.stringify({ [hashKeyForImporter(importer)]: "sha256-fixture" }, null, 2) + "\n",
  );
  return {
    repoRoot,
    importer,
    lockHash,
    cleanup: async () => {
      await fsp.rm(repoRoot, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function seedStoreMarker(
  repoRoot: string,
  importer: string,
  lockHash: string,
): Promise<void> {
  const markerPath = path.join(
    repoRoot,
    ".viberoots",
    "workspace",
    "buck",
    "tmp",
    `pnpm-store-verified.${sanitizeName(importer)}.json`,
  );
  await writeFile(
    markerPath,
    JSON.stringify(
      {
        importer,
        lockfile: hashKeyForImporter(importer),
        lockHash,
        hashValue: "sha256-fixture",
        builderFingerprint: await currentVerifiedMarkerFingerprint(repoRoot, importer),
        derivationIdentity: DERIVATION_IDENTITY,
      },
      null,
      2,
    ) + "\n",
  );
}

async function seedLinkMarker(repoRoot: string, importer: string, lockHash: string): Promise<void> {
  const outPath = path.join(repoRoot, ".fixture-node-modules-out");
  const target = path.join(outPath, "node_modules");
  const importerNodeModules = path.join(repoRoot, importer, "node_modules");
  await fsp.mkdir(target, { recursive: true });
  await fsp.rm(importerNodeModules, { recursive: true, force: true }).catch(() => {});
  await fsp.symlink(target, importerNodeModules);
  await writeFile(
    path.join(
      repoRoot,
      ".viberoots",
      "workspace",
      "buck",
      "tmp",
      `node-modules-link.${sanitizeName(importer)}.json`,
    ),
    JSON.stringify(
      {
        importer,
        lockfile: `${importer}/pnpm-lock.yaml`,
        lockHash,
        outPath,
      },
      null,
      2,
    ) + "\n",
  );
}

test("importer freshness accepts verified linked install state", async () => {
  const repo = await makeRepo();
  try {
    await seedStoreMarker(repo.repoRoot, repo.importer, repo.lockHash);
    await seedLinkMarker(repo.repoRoot, repo.importer, repo.lockHash);

    assert.deepEqual(
      await importerInstallFreshness(
        {
          repoRoot: repo.repoRoot,
          importer: repo.importer,
        },
        FRESHNESS_DEPS,
      ),
      { fresh: true },
    );
  } finally {
    await repo.cleanup();
  }
});

test("importer freshness supports the viberoots importer hash key", async () => {
  const repo = await makeRepo("viberoots");
  try {
    await seedStoreMarker(repo.repoRoot, repo.importer, repo.lockHash);
    await seedLinkMarker(repo.repoRoot, repo.importer, repo.lockHash);

    assert.deepEqual(
      await importerInstallFreshness(
        {
          repoRoot: repo.repoRoot,
          importer: repo.importer,
        },
        FRESHNESS_DEPS,
      ),
      { fresh: true },
    );
  } finally {
    await repo.cleanup();
  }
});

test("importer freshness rejects stale or incomplete install state", async () => {
  const repo = await makeRepo();
  try {
    await seedStoreMarker(repo.repoRoot, repo.importer, repo.lockHash);
    await seedLinkMarker(repo.repoRoot, repo.importer, repo.lockHash);

    assert.deepEqual(
      await importerInstallFreshness(
        {
          repoRoot: repo.repoRoot,
          importer: repo.importer,
        },
        FRESHNESS_DEPS,
      ),
      { fresh: true },
    );

    assert.deepEqual(
      await importerInstallFreshness(
        {
          repoRoot: repo.repoRoot,
          importer: repo.importer,
        },
        {
          currentDerivationIdentity: async () =>
            `/nix/store/${"b".repeat(32)}-pnpm-store-changed.drv`,
        },
      ),
      { fresh: false, reason: "stale-store-marker" },
    );

    await fsp.rm(path.join(repo.repoRoot, repo.importer, "node_modules"));
    assert.deepEqual(
      await importerInstallFreshness(
        {
          repoRoot: repo.repoRoot,
          importer: repo.importer,
        },
        FRESHNESS_DEPS,
      ),
      { fresh: false, reason: "stale-link-marker" },
    );

    await writeFile(
      path.join(repo.repoRoot, repo.importer, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n# changed\n",
    );
    assert.deepEqual(
      await importerInstallFreshness(
        {
          repoRoot: repo.repoRoot,
          importer: repo.importer,
        },
        FRESHNESS_DEPS,
      ),
      { fresh: false, reason: "stale-store-marker" },
    );
  } finally {
    await repo.cleanup();
  }
});
