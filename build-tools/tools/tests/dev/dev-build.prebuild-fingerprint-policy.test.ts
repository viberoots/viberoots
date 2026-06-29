#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { writePrebuildFingerprint } from "../../buck/prebuild/fingerprint";
import { listFreshnessOutputs, listOutputs } from "../../buck/prebuild/scan";
import { shouldMaterializeByDefault } from "../../dev/dev-build/materialize-policy";
import { runInTemp } from "../lib/test-helpers";

async function writeFile(filePath: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf8");
}

async function seedGeneratedPrebuildState(tmp: string): Promise<void> {
  await writeFile(path.join(tmp, "viberoots/build-tools/tools/buck/glue-pipeline.ts"), "input\n");
  await writeFile(path.join(tmp, "prelude/prelude.bzl"), "# prelude\n");
  await writeFile(path.join(tmp, ".viberoots/workspace/buck/graph.json"), "[]\n");
  await writeFile(
    path.join(tmp, ".viberoots/workspace/buck/node-lock-index.json"),
    '{"index":{}}\n',
  );
  await writeFile(path.join(tmp, ".viberoots/workspace/buck/invalidation-report.txt"), "ok\n");
  await writeFile(
    path.join(tmp, ".viberoots/workspace/providers/auto_map.bzl"),
    "MODULE_PROVIDERS = {}\n",
  );
}

async function writeCurrentFingerprint(tmp: string): Promise<void> {
  const cwd = process.cwd();
  try {
    process.chdir(tmp);
    await writePrebuildFingerprint({
      root: tmp,
      outputs: listFreshnessOutputs(listOutputs()),
    });
  } finally {
    process.chdir(cwd);
  }
}

test("dev-build skips prebuild work after install writes fresh fingerprint evidence", async () => {
  await runInTemp("dev-build-fresh-prebuild-fingerprint", async (tmp) => {
    await seedGeneratedPrebuildState(tmp);
    await writeCurrentFingerprint(tmp);

    assert.deepEqual(
      await shouldMaterializeByDefault({
        root: tmp,
        requestedMaterialize: true,
        isCI: false,
      }),
      { materialize: false, reason: "prebuild-guard-fresh" },
    );
  });
});

test("dev-build refreshes prebuild work when fingerprinted tool source drifts", async () => {
  await runInTemp("dev-build-stale-prebuild-fingerprint", async (tmp) => {
    await seedGeneratedPrebuildState(tmp);
    await writeCurrentFingerprint(tmp);

    await fsp.appendFile(
      path.join(tmp, "viberoots/build-tools/tools/buck/glue-pipeline.ts"),
      "\n// changed after install\n",
      "utf8",
    );

    assert.deepEqual(
      await shouldMaterializeByDefault({
        root: tmp,
        requestedMaterialize: true,
        isCI: false,
      }),
      { materialize: true, reason: "prebuild-guard-stale" },
    );
  });
});
