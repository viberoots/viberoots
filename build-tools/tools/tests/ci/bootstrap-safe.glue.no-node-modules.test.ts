#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runGluePipeline } from "../../buck/glue-pipeline";
import { prebuildFingerprintFresh } from "../../buck/prebuild/fingerprint";
import { glueFreshnessOutputs } from "../../dev/install/glue-freshness";
import { withoutArtifactEnvironmentInfluence } from "../../lib/artifact-environment";
import { runInTemp } from "../lib/test-helpers";

async function writeMinimalBuckConfig(tmp: string) {
  await $({ cwd: tmp })`bash --noprofile --norc -c ${`set -euo pipefail
    printf '.\\n' > .buckroot
    cat > .buckconfig <<'EOF'
[buildfile]
name = TARGETS

[repositories]
root = .
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbsource_stub
config = ./prelude

[cells]
root = .
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbsource_stub
config = ./prelude

[build]
prelude = prelude
user_platform = prelude//platforms:default
target_platforms = prelude//platforms:default
EOF
    mkdir -p toolchains
    printf '[buildfile]\\nname = TARGETS\\n' > toolchains/.buckconfig
  `}`;
}

async function seedMinimalGraph(tmp: string) {
  const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
  await fsp.mkdir(graphDir, { recursive: true });
  const content = JSON.stringify({ $schema: "x", version: 1, nodes: [] }, null, 2) + "\n";
  await fsp.writeFile(path.join(graphDir, "graph.json"), content, "utf8");
}

async function dirSnapshot(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(d: string) {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile()) {
        const rel = p.replace(root + path.sep, "");
        const buf = await fsp.readFile(p);
        const digest = crypto.createHash("sha256").update(buf).digest("hex");
        out.set(rel, digest);
      }
    }
  }
  await walk(root);
  return out;
}

test("glue validation stages run without node_modules and are idempotent", async () => {
  await runInTemp("bootstrap-safe-glue", async (tmp, $) => {
    await writeMinimalBuckConfig(tmp);
    await seedMinimalGraph(tmp);

    const callerRoot = path.join(tmp, "pipeline-caller");
    await fsp.mkdir(callerRoot, { recursive: true });
    const originalCwd = process.cwd();
    try {
      process.chdir(callerRoot);
      await runGluePipeline({
        forceGraph: true,
        workspaceRoot: tmp,
        toolSourceRoot: process.env.VIBEROOTS_SOURCE_ROOT || path.join(tmp, "viberoots"),
        env: process.env,
      });
    } finally {
      process.chdir(originalCwd);
    }
    assert.equal(
      await fsp.stat(path.join(callerRoot, ".viberoots")).catch(() => null),
      null,
      "pipeline outputs must resolve beneath the declared workspace root",
    );
    const freshnessOutputs = glueFreshnessOutputs(tmp);
    const missingOutputs = (
      await Promise.all(
        freshnessOutputs.map(async (output) => ({
          output,
          present: Boolean(await fsp.stat(path.resolve(tmp, output)).catch(() => null)),
        })),
      )
    )
      .filter(({ present }) => !present)
      .map(({ output }) => output);
    assert.deepEqual(missingOutputs, []);
    assert.deepEqual(await prebuildFingerprintFresh({ root: tmp, outputs: freshnessOutputs }), {
      fresh: true,
      reason: "fresh",
    });

    // Ensure node_modules is absent
    let nodeModsExists = false;
    try {
      await fsp.access(path.join(tmp, "node_modules"));
      nodeModsExists = true;
    } catch {}
    if (nodeModsExists) {
      console.error("unexpected node_modules present in temp repo");
      process.exit(2);
    }

    const runStage = async (name: string, extraEnv?: Record<string, string>) => {
      await $({
        cwd: tmp,
        stdio: "inherit",
        env: { ...withoutArtifactEnvironmentInfluence(process.env), ...(extraEnv || {}) },
      })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/ci/run-stage.ts --stage ${name}`;
    };

    // Validate the canonical metadata reconciled by the explicit update boundary.
    await runStage("glue");
    await runStage("prebuild-guard");

    // Verify outputs exist
    const providersDir = path.join(tmp, ".viberoots", "workspace", "providers");
    const autoMap = path.join(providersDir, "auto_map.bzl");
    const autoMapTxt = await fsp.readFile(autoMap, "utf8").catch(() => "");
    if (!autoMapTxt.includes("MODULE_PROVIDERS")) {
      console.error("auto_map.bzl missing or malformed");
      process.exit(2);
    }

    // Snapshot outputs, rerun stages, ensure no diffs
    const before = await dirSnapshot(providersDir);
    await runStage("glue");
    const after = await dirSnapshot(providersDir);
    // Compare maps
    if (before.size !== after.size) {
      console.error("provider outputs changed in file count after rerun");
      process.exit(2);
    }
    for (const [k, v] of before.entries()) {
      if (after.get(k) !== v) {
        console.error(`provider output changed for ${k}`);
        process.exit(2);
      }
    }
  });
});
