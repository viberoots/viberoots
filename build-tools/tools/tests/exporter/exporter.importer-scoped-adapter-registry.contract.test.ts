#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { importerScopedAdapterRegistryEntry } from "../../buck/exporter/lang/importer-scoped-registry.ts";
import { runInTemp } from "../lib/test-helpers";

test("importer-scoped adapter registry is stable contract data for node + python", async () => {
  const nodeCfg = importerScopedAdapterRegistryEntry("node");
  const pyCfg = importerScopedAdapterRegistryEntry("python");

  assert.equal(nodeCfg.lockfileBasename, "pnpm-lock.yaml");
  assert.equal(pyCfg.lockfileBasename, "uv.lock");

  {
    const nodeWithLockfileLabel = {
      name: "//projects/apps/web:bundle",
      labels: ["lang:node", "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],
    } as any;
    const nodeWithoutLockfileLabel = {
      name: "//projects/apps/web:bundle",
      labels: ["lang:node"],
    } as any;

    assert.equal(nodeCfg.shouldWarnMissingKindLabel(nodeWithLockfileLabel), true);
    assert.equal(nodeCfg.shouldWarnMissingKindLabel(nodeWithoutLockfileLabel), false);
    assert.equal(nodeCfg.hasLockfileLabelForThisEcosystem(nodeWithLockfileLabel), true);
    assert.equal(nodeCfg.hasLockfileLabelForThisEcosystem(nodeWithoutLockfileLabel), false);
  }

  {
    const pythonWithLockfileLabel = {
      name: "//projects/apps/pytool:tool",
      labels: ["lang:python", "lockfile:projects/apps/pytool/uv.lock#projects/apps/pytool"],
      srcs: ["main.py"],
    } as any;
    const pythonWithoutLockfileLabel = {
      name: "//projects/apps/pytool:tool",
      labels: ["lang:python"],
      srcs: ["main.py"],
    } as any;

    assert.equal(pyCfg.shouldWarnMissingKindLabel(pythonWithLockfileLabel), true);
    assert.equal(pyCfg.shouldWarnMissingKindLabel(pythonWithoutLockfileLabel), false);
    assert.equal(pyCfg.hasLockfileLabelForThisEcosystem(pythonWithLockfileLabel), true);
    assert.equal(pyCfg.hasLockfileLabelForThisEcosystem(pythonWithoutLockfileLabel), false);
  }

  await runInTemp("exp-importer-scoped-registry", async (tmp) => {
    await fs.mkdirp(path.join(tmp, "projects", "apps", "web"));
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "web", "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
      "utf8",
    );

    await fs.mkdirp(path.join(tmp, "projects", "apps", "pytool"));
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "pytool", "uv.lock"),
      "# lock\n",
      "utf8",
    );

    const prevCwd = process.cwd();
    try {
      process.chdir(tmp);
      assert.equal(
        await nodeCfg.findNearestLockfile("projects/apps/web"),
        "projects/apps/web/pnpm-lock.yaml",
      );
      assert.equal(
        await pyCfg.findNearestLockfile("projects/apps/pytool"),
        "projects/apps/pytool/uv.lock",
      );
    } finally {
      process.chdir(prevCwd);
    }
  });
});
