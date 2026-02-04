#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { importerScopedAdapterRegistryEntry } from "../../buck/exporter/lang/importer-scoped-registry.ts";

test("importer-scoped adapter registry is stable contract data for node + python", async () => {
  const nodeCfg = importerScopedAdapterRegistryEntry("node");
  const pyCfg = importerScopedAdapterRegistryEntry("python");

  assert.equal(nodeCfg.lockfileBasename, "pnpm-lock.yaml");
  assert.equal(pyCfg.lockfileBasename, "uv.lock");

  {
    const nodeWithLockfileLabel = {
      name: "//apps/web:bundle",
      labels: ["lang:node", "lockfile:apps/web/pnpm-lock.yaml#apps/web"],
    } as any;
    const nodeWithoutLockfileLabel = {
      name: "//apps/web:bundle",
      labels: ["lang:node"],
    } as any;

    assert.equal(nodeCfg.shouldWarnMissingKindLabel(nodeWithLockfileLabel), true);
    assert.equal(nodeCfg.shouldWarnMissingKindLabel(nodeWithoutLockfileLabel), false);
    assert.equal(nodeCfg.hasLockfileLabelForThisEcosystem(nodeWithLockfileLabel), true);
    assert.equal(nodeCfg.hasLockfileLabelForThisEcosystem(nodeWithoutLockfileLabel), false);
  }

  {
    const pythonWithLockfileLabel = {
      name: "//apps/pytool:tool",
      labels: ["lang:python", "lockfile:apps/pytool/uv.lock#apps/pytool"],
      srcs: ["main.py"],
    } as any;
    const pythonWithoutLockfileLabel = {
      name: "//apps/pytool:tool",
      labels: ["lang:python"],
      srcs: ["main.py"],
    } as any;

    assert.equal(pyCfg.shouldWarnMissingKindLabel(pythonWithLockfileLabel), true);
    assert.equal(pyCfg.shouldWarnMissingKindLabel(pythonWithoutLockfileLabel), false);
    assert.equal(pyCfg.hasLockfileLabelForThisEcosystem(pythonWithLockfileLabel), true);
    assert.equal(pyCfg.hasLockfileLabelForThisEcosystem(pythonWithoutLockfileLabel), false);
  }

  await runInTemp("exp-importer-scoped-registry", async (tmp) => {
    await fs.mkdirp(path.join(tmp, "apps", "web"));
    await fs.outputFile(
      path.join(tmp, "apps", "web", "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
      "utf8",
    );

    await fs.mkdirp(path.join(tmp, "apps", "pytool"));
    await fs.outputFile(path.join(tmp, "apps", "pytool", "uv.lock"), "# lock\n", "utf8");

    const prevCwd = process.cwd();
    try {
      process.chdir(tmp);
      assert.equal(await nodeCfg.findNearestLockfile("apps/web"), "apps/web/pnpm-lock.yaml");
      assert.equal(await pyCfg.findNearestLockfile("apps/pytool"), "apps/pytool/uv.lock");
    } finally {
      process.chdir(prevCwd);
    }
  });
});
