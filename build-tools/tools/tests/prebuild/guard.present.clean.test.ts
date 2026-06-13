#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: clean present outputs passes locally", async () => {
  await runInTemp("prebuild-clean", async (tmp, $) => {
    const providersDir = path.join(tmp, ".viberoots", "workspace", "providers");
    const buckDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fsp.mkdir(providersDir, { recursive: true });
    await fsp.mkdir(buckDir, { recursive: true });
    await fsp.writeFile(path.join(buckDir, "graph.json"), "[]", "utf8");
    await fsp.writeFile(path.join(buckDir, "node-lock-index.json"), "{}\n", "utf8");
    await fsp.writeFile(
      path.join(buckDir, "invalidation-report.txt"),
      "# invalidation-report\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      "# generated\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    await fsp.writeFile(path.join(providersDir, "TARGETS.auto"), "# generated\n", "utf8");
    await fsp.writeFile(path.join(providersDir, "nix_attr_map.bzl"), "NIX_ATTR_MAP = {}\n", "utf8");
    // Ensure Buck mapping exists in temp repo
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
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[cells]
root = .
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[build]
prelude = prelude
user_platform = prelude//platforms:default
target_platforms = prelude//platforms:default
EOF
      mkdir -p toolchains
      printf '[buildfile]\nname = TARGETS\n' > toolchains/.buckconfig
    `}`;
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/buck/prebuild-guard.ts`;
  });
});
