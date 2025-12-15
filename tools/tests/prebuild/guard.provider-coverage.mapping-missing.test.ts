#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: flags missing MODULE_PROVIDERS mapping for nixpkg-labeled node", async () => {
  await runInTemp("prebuild-coverage-mapping-missing", async (tmp, $) => {
    // Providers directory with an existing nix provider stamp (simulates generated provider)
    const providersDir = path.join(tmp, "third_party", "providers");
    await fsp.mkdir(path.join(providersDir, "stamps"), { recursive: true });
    await fsp.writeFile(path.join(providersDir, "stamps", "nix_pkgs_zlib.stamp"), "ok\n", "utf8");

    // Minimal graph.json with a node that carries a nixpkg label
    await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
    const graph = [{ name: "//apps/a:bin", labels: ["nixpkg:pkgs.zlib"] }];
    await fsp.writeFile(
      path.join(tmp, "tools", "buck", "graph.json"),
      JSON.stringify(graph),
      "utf8",
    );

    // auto_map missing the mapping entry for //apps/a:bin (empty mapping)
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      "# gen\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );

    // Ensure Buck cell mapping exists in temp repo
    await $({ cwd: tmp })`bash --noprofile --norc -c ${`set -euo pipefail
      printf '.\n' > .buckroot
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

    // CI should fail due to coverage check: provider exists but mapping is missing
    let failed = false;
    try {
      await $({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, CI: "true" },
      })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error(
        "expected CI mode to fail when mapping in MODULE_PROVIDERS is missing for nixpkg-labeled node",
      );
      process.exit(2);
    }

    // Add the missing mapping and re-run; guard should pass in CI mode now
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      [
        "# gen",
        "MODULE_PROVIDERS = {",
        '  "//apps/a:bin": [',
        '    "//third_party/providers:nix_pkgs_zlib",',
        "  ],",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    // Ensure no stale sidecar is present and refresh graph.json so outputs are fresh vs inputs
    const nodeLockSidecar = path.join(tmp, "tools", "buck", "node-lock-index.json");
    await fsp.writeFile(
      path.join(tmp, "tools", "buck", "graph.json"),
      JSON.stringify(graph),
      "utf8",
    );
    // Create a fresh, minimal sidecar so presence/freshness checks pass in CI
    await fsp.writeFile(nodeLockSidecar, JSON.stringify({ index: {} }), "utf8");
    await $({
      cwd: tmp,
      stdio: "inherit",
      env: { ...process.env, CI: "true" },
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts`;
  });
});
