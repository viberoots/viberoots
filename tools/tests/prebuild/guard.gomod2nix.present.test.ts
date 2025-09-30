#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: CI fails when go.mod present without gomod2nix.toml", async () => {
  await runInTemp("prebuild-gomod2nix", async (tmp, $) => {
    const app = path.join(tmp, "apps", "demo");
    await fsp.mkdir(app, { recursive: true });
    await fsp.writeFile(path.join(app, "go.mod"), "module example.com/demo\n\ngo 1.22\n", "utf8");
    // Ensure minimal Buck config exists so guard runs
    await $({ cwd: tmp })`bash -lc ${`set -euo pipefail
      : > .buckroot
      cat > .buckconfig <<'EOF'
[buildfile]
name = TARGETS

[repositories]
root = .
prelude = ./prelude

toolchains = ./toolchains
repo_toolchains = ./toolchains

[cells]
root = .
prelude = ./prelude

target_platforms = prelude//platforms:default
user_platform = prelude//platforms:default

[build]
prelude = prelude
EOF
      mkdir -p toolchains
      printf '[buildfile]\nname = TARGETS\n' > toolchains/.buckconfig
    `}`;
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
      console.error("expected CI mode to fail when gomod2nix.toml missing");
      process.exit(2);
    }
  });
});
