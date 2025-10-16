#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard auto-fixes when stale and passes thereafter", async () => {
  await runInTemp("scaf-prebuild-guard", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    // Initialize git so git-based checks in dev-build don't error out in temp repos
    await $`git init`;
    await $`bash -lc ${`set -euo pipefail
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
    await $`scaf new go lib demo-lib --yes`;
    // Guard should auto-fix glue if stale and succeed
    await $`env PREBUILD_GUARD_SKEW_MS=5000 node tools/buck/prebuild-guard.ts`;
    // Build also succeeds and guard remains satisfied
    await $`build`;
    await $`env PREBUILD_GUARD_SKEW_MS=5000 node tools/buck/prebuild-guard.ts`;
  });
});
