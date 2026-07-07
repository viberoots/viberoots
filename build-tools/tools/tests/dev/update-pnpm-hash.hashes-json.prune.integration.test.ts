#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  pruneNodeModulesHashesJson,
  readNodeModulesHashForLockfile,
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

test("pruneNodeModulesHashesJson prunes workspace hashes when invoked below root", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "hashes-prune-nested-cwd-"));
  const prevCwd = process.cwd();
  try {
    const projectsDir = path.join(tmp, "projects");
    await fsp.mkdir(projectsDir, { recursive: true });
    const hashesPath = path.join(projectsDir, "node-modules.hashes.json");
    await fsp.writeFile(
      hashesPath,
      JSON.stringify(
        {
          "projects/apps/deleted/pnpm-lock.yaml": "sha256-deleted",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    process.chdir(projectsDir);
    const removed = await pruneNodeModulesHashesJson([], { root: tmp });
    assert.deepEqual(removed, ["projects/apps/deleted/pnpm-lock.yaml"]);

    const next = JSON.parse(await fsp.readFile(hashesPath, "utf8")) as Record<string, string>;
    assert.deepEqual(next, {});
    await assert.rejects(fsp.stat(path.join(projectsDir, "projects", "node-modules.hashes.json")));
  } finally {
    process.chdir(prevCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("hash JSON reads and writes use explicit workspace root below root", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "hashes-nested-cwd-"));
  const prevCwd = process.cwd();
  try {
    const projectsDir = path.join(tmp, "projects");
    await fsp.mkdir(projectsDir, { recursive: true });

    process.chdir(projectsDir);
    await updateNodeModulesHashesJson("projects/apps/demo/pnpm-lock.yaml", "sha256-project", {
      root: tmp,
    });

    assert.equal(
      await readNodeModulesHashForLockfile("projects/apps/demo/pnpm-lock.yaml", { root: tmp }),
      "sha256-project",
    );

    const rootHashesPath = path.join(tmp, "projects", "node-modules.hashes.json");
    const nestedHashesPath = path.join(projectsDir, "projects", "node-modules.hashes.json");
    const next = JSON.parse(await fsp.readFile(rootHashesPath, "utf8")) as Record<string, string>;
    assert.equal(next["projects/apps/demo/pnpm-lock.yaml"], "sha256-project");
    await assert.rejects(fsp.stat(nestedHashesPath));
  } finally {
    process.chdir(prevCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("pruneNodeModulesHashesJson does not mutate extracted viberoots source hashes", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "hashes-prune-extracted-"));
  const prevCwd = process.cwd();
  try {
    process.chdir(tmp);
    const sourceHashesPath = path.join(
      "viberoots",
      "build-tools",
      "tools",
      "nix",
      "node-modules.hashes.json",
    );
    await fsp.mkdir(path.dirname(sourceHashesPath), { recursive: true });
    await fsp.mkdir(path.join("viberoots", "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(
      path.join("viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
      "",
      "utf8",
    );
    await fsp.writeFile(
      sourceHashesPath,
      JSON.stringify(
        {
          "pnpm-lock.yaml": "sha256-source-root",
          "projects/apps/deleted/pnpm-lock.yaml": "sha256-source-deleted",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const consumerHashesPath = path.join("projects", "node-modules.hashes.json");
    await fsp.mkdir(path.dirname(consumerHashesPath), { recursive: true });
    await fsp.writeFile(
      consumerHashesPath,
      JSON.stringify(
        {
          "projects/apps/alive/pnpm-lock.yaml": "sha256-alive",
          "projects/apps/deleted/pnpm-lock.yaml": "sha256-consumer-deleted",
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

    const sourceHashes = JSON.parse(await fsp.readFile(sourceHashesPath, "utf8")) as Record<
      string,
      string
    >;
    const consumerHashes = JSON.parse(await fsp.readFile(consumerHashesPath, "utf8")) as Record<
      string,
      string
    >;
    assert.equal(sourceHashes["projects/apps/deleted/pnpm-lock.yaml"], "sha256-source-deleted");
    assert.equal(consumerHashes["projects/apps/deleted/pnpm-lock.yaml"], undefined);
  } finally {
    process.chdir(prevCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("updateNodeModulesHashesJson writes consumer root hashes to projects ownership", async () => {
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

    const next = JSON.parse(
      await fsp.readFile(path.join("projects", "node-modules.hashes.json"), "utf8"),
    ) as Record<string, string>;
    const sourceHashes = JSON.parse(await fsp.readFile(extractedHashesPath, "utf8")) as Record<
      string,
      string
    >;
    assert.equal(next["pnpm-lock.yaml"], "sha256-root");
    assert.equal(sourceHashes["pnpm-lock.yaml"], undefined);
    await assert.rejects(fsp.stat(path.join("build-tools")));
  } finally {
    process.chdir(prevCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("viberoots-owned pnpm root hash is isolated from consumer root hash", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "hashes-viberoots-owner-"));
  const prevCwd = process.cwd();
  try {
    process.chdir(tmp);
    const sourceHashesPath = path.join(
      "viberoots",
      "build-tools",
      "tools",
      "nix",
      "node-modules.hashes.json",
    );
    const consumerHashesPath = path.join("projects", "node-modules.hashes.json");
    await fsp.mkdir(path.dirname(sourceHashesPath), { recursive: true });
    await fsp.mkdir(path.join("viberoots", "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(
      path.join("viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
      "",
      "utf8",
    );
    await fsp.mkdir(path.dirname(consumerHashesPath), { recursive: true });
    await fsp.writeFile(
      sourceHashesPath,
      JSON.stringify({ "pnpm-lock.yaml": "sha256-source-old" }, null, 2) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      consumerHashesPath,
      JSON.stringify({ "pnpm-lock.yaml": "sha256-consumer-root" }, null, 2) + "\n",
      "utf8",
    );

    assert.equal(
      await readNodeModulesHashForLockfile("pnpm-lock.yaml", { owner: "viberoots" }),
      "sha256-source-old",
    );

    await updateNodeModulesHashesJson("pnpm-lock.yaml", "sha256-source-new", {
      owner: "viberoots",
    });

    const sourceHashes = JSON.parse(await fsp.readFile(sourceHashesPath, "utf8")) as Record<
      string,
      string
    >;
    const consumerHashes = JSON.parse(await fsp.readFile(consumerHashesPath, "utf8")) as Record<
      string,
      string
    >;
    assert.equal(sourceHashes["pnpm-lock.yaml"], "sha256-source-new");
    assert.equal(consumerHashes["pnpm-lock.yaml"], "sha256-consumer-root");
  } finally {
    process.chdir(prevCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("updateNodeModulesHashesJson does not write through activated remote source", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "hashes-remote-current-"));
  const prevCwd = process.cwd();
  try {
    const consumer = path.join(tmp, "consumer");
    const source = path.join(tmp, "remote-source");
    const sourceHashesPath = path.join(
      source,
      "build-tools",
      "tools",
      "nix",
      "node-modules.hashes.json",
    );
    await fsp.mkdir(path.join(consumer, ".viberoots"), { recursive: true });
    await fsp.mkdir(path.join(consumer, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(path.join(consumer, ".viberoots", "workspace", "flake.nix"), "{}\n");
    await fsp.symlink(source, path.join(consumer, ".viberoots", "current"));
    await fsp.mkdir(path.join(source, "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(
      path.join(source, "build-tools", "tools", "dev", "zx-init.mjs"),
      "",
      "utf8",
    );
    await fsp.mkdir(path.dirname(sourceHashesPath), { recursive: true });
    await fsp.writeFile(
      sourceHashesPath,
      JSON.stringify({ "pnpm-lock.yaml": "sha256-source" }, null, 2) + "\n",
      "utf8",
    );

    process.chdir(consumer);
    await updateNodeModulesHashesJson("pnpm-lock.yaml", "sha256-consumer");

    const consumerHashes = JSON.parse(
      await fsp.readFile(path.join(consumer, "projects", "node-modules.hashes.json"), "utf8"),
    ) as Record<string, string>;
    const sourceHashes = JSON.parse(await fsp.readFile(sourceHashesPath, "utf8")) as Record<
      string,
      string
    >;
    assert.equal(consumerHashes["pnpm-lock.yaml"], "sha256-consumer");
    assert.equal(sourceHashes["pnpm-lock.yaml"], "sha256-source");
    await assert.rejects(fsp.stat(path.join(source, "projects", "node-modules.hashes.json")));
  } finally {
    process.chdir(prevCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("updateNodeModulesHashesJson keeps standalone viberoots hashes in tooling ownership", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "hashes-standalone-viberoots-"));
  const prevCwd = process.cwd();
  try {
    process.chdir(tmp);
    const viberootsHashesPath = path.join(
      "build-tools",
      "tools",
      "nix",
      "node-modules.hashes.json",
    );
    await fsp.mkdir(path.join("build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(path.join("build-tools", "tools", "dev", "zx-init.mjs"), "", "utf8");
    await fsp.mkdir(path.dirname(viberootsHashesPath), { recursive: true });
    await fsp.writeFile(viberootsHashesPath, "{}\n", "utf8");

    await updateNodeModulesHashesJson("pnpm-lock.yaml", "sha256-tooling");

    const toolingHashes = JSON.parse(await fsp.readFile(viberootsHashesPath, "utf8")) as Record<
      string,
      string
    >;
    assert.equal(toolingHashes["pnpm-lock.yaml"], "sha256-tooling");
    await assert.rejects(fsp.stat(path.join("projects", "node-modules.hashes.json")));
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
      tmp,
      "viberoots",
      "build-tools",
      "tools",
      "nix",
      "node-modules.hashes.json",
    );
    await fsp.mkdir(path.dirname(viberootsHashesPath), { recursive: true });
    await fsp.mkdir(path.join(tmp, "projects"), { recursive: true });
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
          "projects/apps/demo/pnpm-lock.yaml": "sha256-non-owner-project",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    process.chdir(path.join(tmp, "projects"));
    await updateNodeModulesHashesJson("projects/apps/demo/pnpm-lock.yaml", "sha256-project", {
      root: tmp,
    });

    const projectsHashesPath = path.join(tmp, "projects", "node-modules.hashes.json");
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
    assert.equal(viberootsHashes["projects/apps/demo/pnpm-lock.yaml"], "sha256-non-owner-project");
    await assert.rejects(fsp.stat(path.join("build-tools")));
  } finally {
    process.chdir(prevCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
