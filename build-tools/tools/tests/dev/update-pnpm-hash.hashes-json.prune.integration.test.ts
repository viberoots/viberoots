#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  pruneNodeModulesHashesJson,
  updateNodeModulesHashesJson,
} from "../../dev/update-pnpm-hash/hashes-json";

test("pruneNodeModulesHashesJson removes stale lockfile keys", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "hashes-prune-"));
  const prevCwd = process.cwd();
  try {
    process.chdir(tmp);
    const hashesPath = path.join("projects", "node-modules.hashes.json");
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

test("updateNodeModulesHashesJson writes extracted viberoots hash without recreating root build-tools", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "hashes-extracted-"));
  const prevCwd = process.cwd();
  try {
    process.chdir(tmp);
    const extractedHashesPath = path.join(
      "viberoots",
      "build-tools",
      "tools",
      "nix",
      "node-modules.hashes.json",
    );
    await fsp.mkdir(path.dirname(extractedHashesPath), { recursive: true });
    await fsp.mkdir(path.join("viberoots", "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(
      path.join("viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
      "",
      "utf8",
    );
    await fsp.writeFile(extractedHashesPath, "{}\n", "utf8");

    await updateNodeModulesHashesJson("pnpm-lock.yaml", "sha256-root");

    const next = JSON.parse(await fsp.readFile(extractedHashesPath, "utf8")) as Record<
      string,
      string
    >;
    assert.equal(next["pnpm-lock.yaml"], "sha256-root");
    await assert.rejects(fsp.stat(path.join("build-tools")));
  } finally {
    process.chdir(prevCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("updateNodeModulesHashesJson writes project hashes to projects ownership", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "hashes-project-owned-"));
  const prevCwd = process.cwd();
  try {
    process.chdir(tmp);
    const viberootsHashesPath = path.join(
      "viberoots",
      "build-tools",
      "tools",
      "nix",
      "node-modules.hashes.json",
    );
    await fsp.mkdir(path.dirname(viberootsHashesPath), { recursive: true });
    await fsp.mkdir(path.join("viberoots", "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(
      path.join("viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
      "",
      "utf8",
    );
    await fsp.writeFile(
      viberootsHashesPath,
      JSON.stringify(
        {
          "pnpm-lock.yaml": "sha256-root",
          "projects/apps/demo/pnpm-lock.yaml": "sha256-legacy-project",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    await updateNodeModulesHashesJson("projects/apps/demo/pnpm-lock.yaml", "sha256-project");

    const projectsHashesPath = path.join("projects", "node-modules.hashes.json");
    const projectHashes = JSON.parse(await fsp.readFile(projectsHashesPath, "utf8")) as Record<
      string,
      string
    >;
    const viberootsHashes = JSON.parse(await fsp.readFile(viberootsHashesPath, "utf8")) as Record<
      string,
      string
    >;
    assert.equal(projectHashes["projects/apps/demo/pnpm-lock.yaml"], "sha256-project");
    assert.equal(viberootsHashes["pnpm-lock.yaml"], "sha256-root");
    assert.equal(viberootsHashes["projects/apps/demo/pnpm-lock.yaml"], undefined);
    await assert.rejects(fsp.stat(path.join("build-tools")));
  } finally {
    process.chdir(prevCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
