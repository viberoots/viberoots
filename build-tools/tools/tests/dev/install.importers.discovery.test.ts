#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { discoverImportersWithLock } from "../../dev/install/importers";

const cleanupDirs: string[] = [];

after(async () => {
  await Promise.all(
    cleanupDirs.map(async (dir) => await fsp.rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempRepo(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "install-importers-"));
  cleanupDirs.push(dir);
  runGit(dir, "init");
  await writeFile(path.join(dir, "flake.nix"), "{ }\n");
  return dir;
}

function runGit(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || `git ${args.join(" ")} failed`);
}

async function writeFile(file: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, "utf8");
}

test("install importer discovery ignores stray untracked importers from repo root", async () => {
  const repo = await makeTempRepo();
  await writeFile(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  await writeFile(
    path.join(repo, "projects", "apps", "kept", "pnpm-lock.yaml"),
    "lockfileVersion: 9\n",
  );
  await writeFile(
    path.join(repo, "projects", "apps", "stray", "pnpm-lock.yaml"),
    "lockfileVersion: 9\n",
  );
  runGit(repo, "add", "flake.nix", "pnpm-lock.yaml", "projects/apps/kept/pnpm-lock.yaml");

  const importers = await discoverImportersWithLock(repo, { cwd: repo });

  assert.deepEqual(importers, [".", "projects/apps/kept"]);
});

test("install importer discovery keeps the current untracked importer when run inside it", async () => {
  const repo = await makeTempRepo();
  const strayImporter = path.join(repo, "projects", "apps", "stray");
  await writeFile(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  await writeFile(
    path.join(repo, "projects", "apps", "kept", "pnpm-lock.yaml"),
    "lockfileVersion: 9\n",
  );
  await writeFile(path.join(strayImporter, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  runGit(repo, "add", "flake.nix", "pnpm-lock.yaml", "projects/apps/kept/pnpm-lock.yaml");

  const importers = await discoverImportersWithLock(repo, { cwd: strayImporter });

  assert.deepEqual(importers, [".", "projects/apps/kept", "projects/apps/stray"]);
});
