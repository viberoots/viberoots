#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: missing outputs warns locally and fails in CI", async () => {
  await runInTemp("prebuild-missing", async (tmp, $) => {
    // Ensure a patch exists to require provider autos
    await fsp.mkdir(path.join(tmp, "patches", "go"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "patches", "go", "example.com__mod@v0.0.1.patch"),
      "diff --git a/b b\n",
      "utf8",
    );
    // Ensure Buck mapping exists in temp repo
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
    // No outputs created
    // Local should not exit non-zero
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts`;
    // CI should fail
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
      console.error("expected CI mode to fail when outputs missing");
      process.exit(2);
    }
  });
});
