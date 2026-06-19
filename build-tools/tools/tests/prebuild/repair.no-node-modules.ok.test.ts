#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_GRAPH_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
  DEFAULT_PROVIDER_INDEX_PATH,
  WORKSPACE_BUCK_STATE_DIR,
} from "../../lib/workspace-state-paths";

test("prebuild/repair runs without node_modules and generates glue", async () => {
  await runInTemp("prebuild-repair-no-node-mods", async (tmp, $) => {
    // Ensure Buck cell mapping exists in temp repo so repair's ensureLocalPreludeMapping is a no-op
    await $({ cwd: tmp })`bash --noprofile --norc -c ${`set -euo pipefail
      printf '.\\n' > .buckroot
      cat > .buckconfig <<'EOF'
[buildfile]
name = TARGETS

[repositories]
root = .
prelude = ./prelude
viberoots = .
workspace_buck = ./.viberoots/workspace/buck
workspace_providers = ./.viberoots/workspace/providers
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbsource_stub
config = ./prelude

[cells]
root = .
prelude = ./prelude
viberoots = .
workspace_buck = ./.viberoots/workspace/buck
workspace_providers = ./.viberoots/workspace/providers
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

    // Seed a minimal non-empty graph so ensureGraph() is a no-op (avoids buck/nix)
    const graphDir = path.join(tmp, WORKSPACE_BUCK_STATE_DIR);
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(
      path.join(tmp, DEFAULT_GRAPH_PATH),
      JSON.stringify({ $schema: "x", version: 1, nodes: [] }, null, 2) + "\n",
      "utf8",
    );

    // Sanity: node_modules should be absent (early-path must not require it)
    let nodeModsExists = false;
    try {
      await fsp.access(path.join(tmp, "node_modules"));
      nodeModsExists = true;
    } catch {}
    if (nodeModsExists) {
      console.error("unexpected node_modules present in temp repo");
      process.exit(2);
    }

    // Run the repair script; it will call install-deps --glue-only and run unified glue
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild/repair.ts`;

    // Verify glue outputs were generated
    const autoMap = path.join(tmp, DEFAULT_AUTO_MAP_PATH);
    const providerIdx = path.join(tmp, DEFAULT_PROVIDER_INDEX_PATH);
    const invalidationReport = path.join(tmp, DEFAULT_INVALIDATION_REPORT_PATH);
    const autoMapTxt = await fsp.readFile(autoMap, "utf8").catch(() => "");
    const providerIdxTxt = await fsp.readFile(providerIdx, "utf8").catch(() => "");
    const reportTxt = await fsp.readFile(invalidationReport, "utf8").catch(() => "");
    if (!autoMapTxt.includes("MODULE_PROVIDERS = {")) {
      console.error("auto_map.bzl missing or malformed");
      process.exit(2);
    }
    if (!providerIdxTxt.includes("PROVIDER_INDEX = {")) {
      console.error("provider_index.bzl missing or malformed");
      process.exit(2);
    }
    if (!reportTxt.includes("# invalidation-report")) {
      console.error("invalidation-report.txt missing or malformed");
      process.exit(2);
    }
  });
});
