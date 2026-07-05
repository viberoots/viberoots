#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { handleNonDefaultImporter } from "../../dev/update-pnpm-hash/nondefault";
import {
  currentSharedPnpmStoreHashCacheFingerprint,
  currentVerifiedMarkerFingerprint,
  readVerifiedMarker,
  readSharedHashCache,
  writeSharedHashCache,
} from "../../dev/update-pnpm-hash/verified-marker";

test("shared pnpm-store hash cache can use an explicit durable root", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-shared-cache-"));
  const prevRepoRoot = process.env.REPO_ROOT;
  const prevSharedRoot = process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
  const durableRoot = path.join(repoRoot, "durable-cache-root");
  process.env.REPO_ROOT = path.join(repoRoot, "temp-repo");
  process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = durableRoot;
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
    const durableEntries = await fsp.readdir(
      path.join(durableRoot, ".viberoots", "workspace", "buck", "pnpm-store-hash-cache"),
    );
    assert.deepEqual(durableEntries, ["builder-1"]);
  } finally {
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
    if (prevSharedRoot === undefined) delete process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
    else process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = prevSharedRoot;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});

test("shared pnpm-store hash cache prefers workspace root over nested repo root", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-shared-cache-workspace-"));
  const workspaceRoot = path.join(root, "workspace");
  const nestedRepoRoot = path.join(workspaceRoot, "viberoots");
  const prevRepoRoot = process.env.REPO_ROOT;
  const prevWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const prevSharedRoot = process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
  delete process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
  process.env.WORKSPACE_ROOT = workspaceRoot;
  process.env.REPO_ROOT = nestedRepoRoot;
  try {
    await writeSharedHashCache(nestedRepoRoot, {
      lockHash: "lock-a",
      hashValue: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=",
      builderFingerprint: "builder-1",
    });

    assert.equal(
      await readSharedHashCache({
        repoRoot: nestedRepoRoot,
        builderFingerprint: "builder-1",
        lockHash: "lock-a",
      }),
      "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=",
    );
    assert.deepEqual(
      await fsp.readdir(
        path.join(workspaceRoot, ".viberoots", "workspace", "buck", "pnpm-store-hash-cache"),
      ),
      ["builder-1"],
    );
    await assert.rejects(
      fsp.readdir(
        path.join(nestedRepoRoot, ".viberoots", "workspace", "buck", "pnpm-store-hash-cache"),
      ),
    );
  } finally {
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
    if (prevWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = prevWorkspaceRoot;
    if (prevSharedRoot === undefined) delete process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
    else process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = prevSharedRoot;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("non-default pnpm-store hash refresh verifies restored shared-cache hits", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-shared-cache-lock-"));
  const prevRepoRoot = process.env.REPO_ROOT;
  const prevCwd = process.cwd();
  const hashValue = "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=";
  const builderFingerprint = `builder-${path.basename(repoRoot)}`;
  const lockHash = `lock-${path.basename(repoRoot)}`;
  const key = "projects/libs/demo/pnpm-lock.yaml";
  const markerPath = path.join(repoRoot, "buck-out", "tmp", "pnpm-store-verified.demo.json");
  const fixedPhases: string[] = [];
  let prepareCount = 0;

  process.env.REPO_ROOT = repoRoot;
  process.chdir(repoRoot);
  try {
    await fsp.mkdir(path.join(repoRoot, "projects"), { recursive: true });
    await fsp.mkdir(path.join(repoRoot, "projects", "libs", "demo"), { recursive: true });
    await fsp.writeFile(
      path.join(repoRoot, "projects", "node-modules.hashes.json"),
      "{}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(repoRoot, "projects", "libs", "demo", "package.json"),
      '{"scripts":{}}\n',
      "utf8",
    );
    await fsp.writeFile(
      path.join(repoRoot, key),
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

    const runOne = async () =>
      await handleNonDefaultImporter({
        importer: "projects/libs/demo",
        key,
        repoRoot,
        builderFingerprint,
        storeAttr: "pnpm-store.projects-libs-demo",
        unfixedAttr: "pnpm-store-unfixed.projects-libs-demo",
        timeoutSec: "600",
        force: false,
        markerPath,
        hasValidExistingHash: false,
        existingHash: "",
        existingLockHash: lockHash,
        existingMarker: null,
        runFixedBuild: async (phaseLabel) => {
          fixedPhases.push(phaseLabel);
          await new Promise((resolve) => setTimeout(resolve, 50));
          const rawHashes = await fsp.readFile(
            path.join(repoRoot, "projects", "node-modules.hashes.json"),
            "utf8",
          );
          const currentHash = (JSON.parse(rawHashes) as Record<string, string>)[key] || "";
          if (phaseLabel.includes("fixed-build-after-hash") || currentHash === hashValue) {
            return { ok: true, output: "" };
          }
          return { ok: false, output: `got: ${hashValue}` };
        },
        runUnfixedBuild: async () => {
          throw new Error("shared-cache verification test should not run unfixed build");
        },
        prepareExactStore: async () => {
          prepareCount++;
        },
      });

    assert.deepEqual(await Promise.all([runOne(), runOne()]), [true, true]);
    assert.deepEqual(fixedPhases, [
      "importer=projects/libs/demo step=fixed-build attr=pnpm-store.projects-libs-demo",
      "importer=projects/libs/demo step=fixed-build-after-hash attr=pnpm-store.projects-libs-demo",
      "importer=projects/libs/demo step=shared-hash-cache attr=pnpm-store.projects-libs-demo",
    ]);
    assert.equal(prepareCount, 1);
    assert.equal(await readSharedHashCache({ repoRoot, builderFingerprint, lockHash }), hashValue);
  } finally {
    process.chdir(prevCwd);
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});

test("non-default force-store refresh bypasses shared-cache restoration", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-shared-cache-force-"));
  const prevRepoRoot = process.env.REPO_ROOT;
  const prevCwd = process.cwd();
  const cachedHash = "sha256-ccccccccccccccccccccccccccccccccccccccccccc=";
  const nextHash = "sha256-ddddddddddddddddddddddddddddddddddddddddddd=";
  const builderFingerprint = `builder-${path.basename(repoRoot)}`;
  const lockHash = `lock-${path.basename(repoRoot)}`;
  const key = "projects/libs/demo/pnpm-lock.yaml";
  const markerPath = path.join(repoRoot, "buck-out", "tmp", "pnpm-store-verified.demo.json");
  const fixedPhases: string[] = [];

  process.env.REPO_ROOT = repoRoot;
  process.chdir(repoRoot);
  try {
    await fsp.mkdir(path.join(repoRoot, "projects", "libs", "demo"), { recursive: true });
    await fsp.writeFile(
      path.join(repoRoot, "projects", "node-modules.hashes.json"),
      JSON.stringify({ [key]: cachedHash }, null, 2) + "\n",
      "utf8",
    );
    await fsp.writeFile(path.join(repoRoot, "projects", "libs", "demo", "package.json"), "{}\n");
    await fsp.writeFile(
      path.join(repoRoot, key),
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
    await writeSharedHashCache(repoRoot, {
      lockHash,
      hashValue: cachedHash,
      builderFingerprint,
    });

    assert.equal(
      await handleNonDefaultImporter({
        importer: "projects/libs/demo",
        key,
        repoRoot,
        builderFingerprint,
        storeAttr: "pnpm-store.projects-libs-demo",
        unfixedAttr: "pnpm-store-unfixed.projects-libs-demo",
        timeoutSec: "600",
        force: true,
        markerPath,
        hasValidExistingHash: true,
        existingHash: cachedHash,
        existingLockHash: lockHash,
        existingMarker: null,
        runFixedBuild: async (phaseLabel) => {
          fixedPhases.push(phaseLabel);
          const rawHashes = await fsp.readFile(
            path.join(repoRoot, "projects", "node-modules.hashes.json"),
            "utf8",
          );
          const currentHash = (JSON.parse(rawHashes) as Record<string, string>)[key] || "";
          if (phaseLabel.includes("fixed-build-after-hash") && currentHash === nextHash) {
            return { ok: true, output: "" };
          }
          return { ok: false, output: `got: ${nextHash}` };
        },
        runUnfixedBuild: async () => {
          throw new Error("force shared-cache bypass test should not run unfixed build");
        },
        prepareExactStore: async () => {},
      }),
      true,
    );
    assert.deepEqual(fixedPhases, [
      "importer=projects/libs/demo step=fixed-build attr=pnpm-store.projects-libs-demo",
      "importer=projects/libs/demo step=fixed-build-after-hash attr=pnpm-store.projects-libs-demo",
    ]);
  } finally {
    process.chdir(prevCwd);
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});

test("shared pnpm-store hash cache reuses verified identical lockfiles across importer names", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-shared-cache-importers-"));
  const prevRepoRoot = process.env.REPO_ROOT;
  const prevCwd = process.cwd();
  const hashValue = "sha256-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee=";
  const lockHash = `lock-${path.basename(repoRoot)}`;
  const sharedCacheBuilderFingerprint = "shared-store-builder";
  const fixedPhases: string[] = [];
  const preparedImporters: string[] = [];

  process.env.REPO_ROOT = repoRoot;
  process.chdir(repoRoot);
  try {
    await fsp.mkdir(path.join(repoRoot, "projects", "apps", "demo-a"), { recursive: true });
    await fsp.mkdir(path.join(repoRoot, "projects", "apps", "demo-b"), { recursive: true });
    await fsp.writeFile(
      path.join(repoRoot, "projects", "node-modules.hashes.json"),
      "{}\n",
      "utf8",
    );
    for (const name of ["demo-a", "demo-b"]) {
      await fsp.writeFile(
        path.join(repoRoot, "projects", "apps", name, "package.json"),
        JSON.stringify({ name: `@apps/${name}`, scripts: {} }, null, 2) + "\n",
        "utf8",
      );
      await fsp.writeFile(
        path.join(repoRoot, "projects", "apps", name, "pnpm-lock.yaml"),
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

    const runImporter = async (name: string) => {
      const importer = `projects/apps/${name}`;
      const key = `${importer}/pnpm-lock.yaml`;
      const builderFingerprint = `builder-for-${name}`;
      const markerPath = path.join(repoRoot, "buck-out", "tmp", `pnpm-store-verified.${name}.json`);
      return await handleNonDefaultImporter({
        importer,
        key,
        repoRoot,
        builderFingerprint,
        sharedCacheBuilderFingerprint,
        storeAttr: `pnpm-store.projects-apps-${name}`,
        unfixedAttr: `pnpm-store-unfixed.projects-apps-${name}`,
        timeoutSec: "600",
        force: false,
        markerPath,
        hasValidExistingHash: false,
        existingHash: "",
        existingLockHash: lockHash,
        existingMarker: null,
        runFixedBuild: async (phaseLabel) => {
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
        },
        runUnfixedBuild: async () => {
          throw new Error("cross-importer shared-cache test should not run unfixed build");
        },
        prepareExactStore: async () => {
          preparedImporters.push(importer);
        },
      });
    };

    assert.equal(await runImporter("demo-a"), true);
    assert.equal(await runImporter("demo-b"), true);
    assert.deepEqual(fixedPhases, [
      "importer=projects/apps/demo-a step=fixed-build attr=pnpm-store.projects-apps-demo-a",
      "importer=projects/apps/demo-a step=fixed-build-after-hash attr=pnpm-store.projects-apps-demo-a",
      "importer=projects/apps/demo-b step=shared-hash-cache attr=pnpm-store.projects-apps-demo-b",
    ]);
    assert.deepEqual(preparedImporters, ["projects/apps/demo-b"]);
    assert.equal(
      await readSharedHashCache({
        repoRoot,
        builderFingerprint: sharedCacheBuilderFingerprint,
        lockHash,
      }),
      hashValue,
    );
    const marker = await readVerifiedMarker(
      path.join(repoRoot, "buck-out", "tmp", "pnpm-store-verified.demo-b.json"),
    );
    assert.equal(marker?.builderFingerprint, "builder-for-demo-b");
  } finally {
    process.chdir(prevCwd);
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});

test("non-default marker fast path proves already verified hashes before accepting them", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-marker-fastpath-"));
  const prevRepoRoot = process.env.REPO_ROOT;
  const prevCwd = process.cwd();
  const verifiedHash = "sha256-fffffffffffffffffffffffffffffffffffffffffff=";
  const builderFingerprint = `builder-${path.basename(repoRoot)}`;
  const lockHash = `lock-${path.basename(repoRoot)}`;
  const key = "projects/apps/demo/pnpm-lock.yaml";
  const markerPath = path.join(repoRoot, "buck-out", "tmp", "pnpm-store-verified.demo.json");
  const fixedPhases: string[] = [];
  let prepared = false;

  process.env.REPO_ROOT = repoRoot;
  process.chdir(repoRoot);
  try {
    await fsp.mkdir(path.join(repoRoot, "projects", "apps", "demo"), { recursive: true });
    await fsp.writeFile(
      path.join(repoRoot, "projects", "node-modules.hashes.json"),
      JSON.stringify({ [key]: verifiedHash }, null, 2) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(repoRoot, "projects", "apps", "demo", "package.json"),
      '{"scripts":{}}\n',
      "utf8",
    );
    await fsp.writeFile(
      path.join(repoRoot, key),
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
        existingHash: verifiedHash,
        existingLockHash: lockHash,
        existingMarker: {
          importer: "projects/apps/demo",
          lockfile: key,
          lockHash,
          hashValue: verifiedHash,
          builderFingerprint,
        },
        acceptedBuilderFingerprints: [builderFingerprint],
        runFixedBuild: async (phaseLabel) => {
          fixedPhases.push(phaseLabel);
          return { ok: true, output: "" };
        },
        runUnfixedBuild: async () => {
          throw new Error("matching marker fast path should not run unfixed build");
        },
        prepareExactStore: async () => {
          prepared = true;
        },
      }),
      true,
    );
    assert.deepEqual(fixedPhases, [
      "importer=projects/apps/demo step=skip-existing-hash attr=pnpm-store.projects-apps-demo",
    ]);
    assert.equal(prepared, true);
    const marker = await readVerifiedMarker(markerPath);
    assert.equal(marker?.hashValue, verifiedHash);
  } finally {
    process.chdir(prevCwd);
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});

test("shared cache fingerprint excludes package identity while verified marker fingerprint remains importer-aware", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-shared-cache-fingerprint-"));
  try {
    for (const name of ["demo-a", "demo-b"]) {
      await fsp.mkdir(path.join(repoRoot, "projects", "apps", name), { recursive: true });
      await fsp.writeFile(
        path.join(repoRoot, "projects", "apps", name, "package.json"),
        JSON.stringify({ name, private: true, scripts: { build: `echo ${name}` } }, null, 2) + "\n",
        "utf8",
      );
    }
    const markerA = await currentVerifiedMarkerFingerprint(repoRoot, "projects/apps/demo-a");
    const markerB = await currentVerifiedMarkerFingerprint(repoRoot, "projects/apps/demo-b");
    assert.notEqual(markerA, markerB);
    assert.equal(
      await currentSharedPnpmStoreHashCacheFingerprint(repoRoot, "projects/apps/demo-a"),
      await currentSharedPnpmStoreHashCacheFingerprint(repoRoot, "projects/apps/demo-b"),
    );
    await fsp.writeFile(
      path.join(repoRoot, "projects", "apps", "demo-b", "pnpm-workspace.yaml"),
      "packages:\n  - ./\noverrides:\n  nanoid: 3.3.11\n",
      "utf8",
    );
    assert.notEqual(
      await currentSharedPnpmStoreHashCacheFingerprint(repoRoot, "projects/apps/demo-a"),
      await currentSharedPnpmStoreHashCacheFingerprint(repoRoot, "projects/apps/demo-b"),
    );
  } finally {
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});
