#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import {
  defaultFilteredFlakeSnapshotRelPaths,
  defaultFilteredFlakeSnapshotRsyncSources,
  filteredFlakeRsyncExcludeArgs,
} from "../../dev/nix-build-filtered-flake-lib";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";

const execFileAsync = promisify(execFile);
let immutableSourcePromise: Promise<string> | undefined;
const protectedPaths = [
  ".gitmodules",
  "flake.nix",
  "flake.lock",
  ".viberoots/workspace/flake.lock",
  ".viberoots/bootstrap/transactions/source-mode.json",
] as const;

async function run(root: string, args: string[] = []) {
  const immutableSource = await immutableViberootsSource();
  return await execFileAsync(path.join(VIBEROOTS_SOURCE_ROOT, "build-tools/tools/bin/u"), args, {
    cwd: root,
    env: {
      ...process.env,
      NO_DEV_SHELL: "1",
      WORKSPACE_ROOT: root,
      VIBEROOTS_SOURCE_ROOT: immutableSource,
      VIBEROOTS_FLAKE_INPUT_ROOT: immutableSource,
    },
    timeout: 180_000,
    maxBuffer: 1024 * 1024 * 32,
  });
}

async function immutableViberootsSource(): Promise<string> {
  immutableSourcePromise ||= (async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-u-filtered-source-"));
    const filtered = path.join(tmp, "input");
    await fsp.mkdir(filtered);
    try {
      const relPaths: string[] = [];
      for (const rel of defaultFilteredFlakeSnapshotRelPaths()) {
        if (
          await fsp.access(path.join(VIBEROOTS_SOURCE_ROOT, rel)).then(
            () => true,
            () => false,
          )
        ) {
          relPaths.push(rel);
        }
      }
      await execFileAsync(
        "rsync",
        [
          "-a",
          "--delete",
          "--relative",
          ...filteredFlakeRsyncExcludeArgs(),
          ...defaultFilteredFlakeSnapshotRsyncSources(relPaths),
          `${filtered}/`,
        ],
        { cwd: VIBEROOTS_SOURCE_ROOT },
      );
      return (await materializeFilteredViberootsSource(filtered)).storePath;
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  })();
  return await immutableSourcePromise;
}

async function snapshot(root: string) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-s", "viberoots"], { cwd: root });
  return {
    gitlink: stdout.trim(),
    files: await Promise.all(
      protectedPaths.map(async (rel) => [rel, await fsp.readFile(path.join(root, rel))] as const),
    ),
  };
}

async function fixture(name: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `vbr-u-launcher-${name}-`));
  await fsp.mkdir(path.join(root, ".viberoots/bootstrap/transactions"), { recursive: true });
  await fsp.mkdir(path.join(root, ".viberoots/workspace"), { recursive: true });
  await fsp.symlink(VIBEROOTS_SOURCE_ROOT, path.join(root, ".viberoots/current"));
  await fsp.writeFile(
    path.join(root, ".gitmodules"),
    '[submodule "viberoots"]\n\tpath = viberoots\n\turl = https://example.invalid/viberoots.git\n',
  );
  const consumerRoot = path.dirname(VIBEROOTS_SOURCE_ROOT);
  await fsp.copyFile(path.join(consumerRoot, "flake.nix"), path.join(root, "flake.nix"));
  await fsp.copyFile(path.join(consumerRoot, "flake.lock"), path.join(root, "flake.lock"));
  await fsp.copyFile(
    path.join(consumerRoot, ".viberoots/workspace/flake.lock"),
    path.join(root, ".viberoots/workspace/flake.lock"),
  );
  await fsp.writeFile(
    path.join(root, ".viberoots/bootstrap/transactions/source-mode.json"),
    '{"mode":"submodule","status":"completed"}\n',
  );
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync(
    "git",
    [
      "update-index",
      "--add",
      "--cacheinfo",
      "160000,0123456789012345678901234567890123456789,viberoots",
    ],
    { cwd: root },
  );
  await execFileAsync("git", ["add", ...protectedPaths], { cwd: root });
  return root;
}

async function addOfflineSurfaces(root: string): Promise<void> {
  const importer = path.join(root, "projects/apps/mixed");
  await addOfflinePnpm(root, importer);
  await fsp.writeFile(path.join(importer, "go.mod"), "module example.test/mixed\n");
  await fsp.writeFile(
    path.join(importer, "pyproject.toml"),
    "[project]\nname='mixed'\nversion='0.0.0'\nrequires-python='>=3.11'\n",
  );
  await fsp.writeFile(path.join(importer, "main.cpp"), "int main() { return 0; }\n");
  await execFileAsync("git", ["add", "projects"], { cwd: root });
}

async function addOfflinePnpm(root: string, importer: string, version = 1): Promise<void> {
  const localName = `local-package-v${version}`;
  const localPackage = path.join(importer, localName);
  await fsp.mkdir(localPackage, { recursive: true });
  await fsp.writeFile(
    path.join(localPackage, "package.json"),
    `{"name":"local-package","version":"${version}.0.0"}\n`,
  );
  await fsp.writeFile(
    path.join(importer, "package.json"),
    `{"name":"mixed","private":true,"dependencies":{"local-package":"file:./${localName}"}}\n`,
  );
  await fsp.writeFile(
    path.join(importer, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
  );
}

test("real u repairs bounded offline language inputs without moving viberoots", async () => {
  const root = await fixture("plain");
  try {
    await addOfflineSurfaces(root);
    const before = await snapshot(root);
    await run(root);
    assert.deepEqual(await snapshot(root), before);
    await fsp.access(path.join(root, "projects/apps/mixed/go.sum"));
    await fsp.access(path.join(root, "projects/apps/mixed/gomod2nix.toml"));
    await fsp.access(path.join(root, "projects/apps/mixed/uv.lock"));
    const glueFingerprint = JSON.parse(
      await fsp.readFile(
        path.join(root, ".viberoots/workspace/buck/prebuild-fingerprint.json"),
        "utf8",
      ),
    ) as { outputs?: string[] };
    assert.ok(
      glueFingerprint.outputs?.includes(".viberoots/current/build-tools/lang/nix_attr_aliases.bzl"),
      "real u must record repaired C++ source-selection metadata in the glue fingerprint",
    );
    assert.match(
      await fsp.readFile(path.join(root, "projects/apps/mixed/pnpm-lock.yaml"), "utf8"),
      /local-package/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("real u --upgrade rejects unsupported languages before mutation", async () => {
  const root = await fixture("unsupported-upgrade");
  try {
    await addOfflineSurfaces(root);
    const before = await snapshot(root);
    const statusBefore = await execFileAsync("git", ["status", "--short"], { cwd: root });
    await assert.rejects(
      run(root, ["--upgrade"]),
      /unsupported.*Go, Python\/uv, C\+\+[\s\S]*no files were modified/,
    );
    assert.deepEqual(await snapshot(root), before);
    assert.equal(
      (await execFileAsync("git", ["status", "--short"], { cwd: root })).stdout,
      statusBefore.stdout,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("real u --upgrade upgrades a bounded offline pnpm importer without moving viberoots", async () => {
  const root = await fixture("pnpm-upgrade");
  try {
    const importer = path.join(root, "projects/apps/pnpm-only");
    await addOfflinePnpm(root, importer);
    await execFileAsync("git", ["add", "projects"], { cwd: root });
    const beforeInitialUpdate = await snapshot(root);
    await run(root);
    assert.deepEqual(await snapshot(root), beforeInitialUpdate);
    const lock = path.join(importer, "pnpm-lock.yaml");
    const versionOneLock = await fsp.readFile(lock, "utf8");
    assert.match(versionOneLock, /file:local-package-v1/);
    await addOfflinePnpm(root, importer, 2);
    const before = await snapshot(root);
    await run(root, ["--upgrade"]);
    assert.deepEqual(await snapshot(root), before);
    const versionTwoLock = await fsp.readFile(lock, "utf8");
    assert.notEqual(versionTwoLock, versionOneLock);
    assert.match(versionTwoLock, /file:local-package-v2/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
