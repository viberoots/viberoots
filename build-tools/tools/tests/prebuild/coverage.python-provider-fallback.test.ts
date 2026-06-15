#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { providerNameForImporter } from "../../lib/providers";

test("prebuild-guard: coverage falls back to TARGETS.*.auto for Python importer providers", async () => {
  await runInTemp("prebuild-coverage-python-fallback", async (tmp, $) => {
    const providersDir = path.join(tmp, ".viberoots", "workspace", "providers");
    const buckDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fsp.mkdir(providersDir, { recursive: true });

    // Minimal glue outputs (graph + auto_map) present
    await fsp.mkdir(buckDir, { recursive: true });

    // Create a Python importer with uv.lock
    const importerDir = path.join(tmp, "apps", "pytool");
    await fsp.mkdir(importerDir, { recursive: true });
    const relUv = "apps/pytool/uv.lock";
    await fsp.writeFile(path.join(tmp, relUv), "# uv lock\n", "utf8");

    const importer = "apps/pytool";
    const provider = providerNameForImporter(relUv, importer);
    const fqProvider = `workspace_providers//:${provider}`;

    // TARGETS.python.auto includes the expected provider rule (no provider_index.json present)
    const targetsPy = path.join(providersDir, "TARGETS.python.auto");
    await fsp.writeFile(
      targetsPy,
      [
        'load("@workspace_providers//:defs_python.bzl", "python_importer_deps")',
        "",
        "python_importer_deps(",
        `    name = "${provider}",`,
        `    lockfile = "${relUv}",`,
        `    importer = "${importer}",`,
        "    patch_paths = [],",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    // Provide auto_map mapping for the node to the provider
    const nodeName = "//projects/apps/pytool:bin";
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      [
        "# gen",
        "MODULE_PROVIDERS = {",
        `  "${nodeName}": [`,
        `    "${fqProvider}",`,
        "  ],",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    // Minimal graph pointing to the Python node with an importer-scoped lockfile label
    const graph = [{ name: nodeName, labels: [`lockfile:${relUv}#${importer}`] }];
    await fsp.writeFile(path.join(buckDir, "graph.json"), JSON.stringify(graph), "utf8");
    await fsp.writeFile(path.join(buckDir, "node-lock-index.json"), "{}\n", "utf8");
    await fsp.writeFile(
      path.join(buckDir, "invalidation-report.txt"),
      "# invalidation-report\n",
      "utf8",
    );

    // Presence check requires nix_attr_map when any TARGETS.*.auto exists
    await fsp.writeFile(
      path.join(providersDir, "nix_attr_map.bzl"),
      "# gen\nNIX_ATTR_MAP = {}\n",
      "utf8",
    );

    // Buck cell mapping (keeps helpers happy in temp repos)
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

    // Local mode should pass: provider_index is absent but TARGETS.python.auto contains the provider rule.
    // Use NO_FIX to avoid auto-fix paths interfering with coverage assertions in this focused test.
    await $({
      cwd: tmp,
      stdio: "inherit",
      env: { ...process.env, PREBUILD_GUARD_NO_FIX: "1" },
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/buck/prebuild-guard.ts`;
  });
});
