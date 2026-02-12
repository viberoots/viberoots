#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
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
  const graphDir = path.join(tmp, "build-tools", "tools", "buck");
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

test("glue stages run without node_modules and are idempotent", async () => {
  await runInTemp("bootstrap-safe-glue", async (tmp, $) => {
    await writeMinimalBuckConfig(tmp);
    await seedMinimalGraph(tmp);

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
        env: { ...process.env, ...(extraEnv || {}) },
      })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/ci/run-stage.ts --stage ${name}`;
    };

    // Run each glue stage
    await runStage("export-graph");
    await runStage("sync-providers");
    await runStage("gen-auto-map");
    await runStage("prebuild-guard");

    // Verify outputs exist
    const providersDir = path.join(tmp, "third_party", "providers");
    const autoMap = path.join(providersDir, "auto_map.bzl");
    const autoMapTxt = await fsp.readFile(autoMap, "utf8").catch(() => "");
    if (!autoMapTxt.includes("MODULE_PROVIDERS")) {
      console.error("auto_map.bzl missing or malformed");
      process.exit(2);
    }

    // Snapshot outputs, rerun stages, ensure no diffs
    const before = await dirSnapshot(providersDir);
    await runStage("sync-providers");
    await runStage("gen-auto-map");
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
