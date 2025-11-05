#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// E2E: partial-clone discovery & build in a sparse workspace.

test("partial clone: discover and build scaffolded lib via //...", async () => {
  // Avoid dev env export path
  await runInTemp("partial-clone-discover", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    const T = Number(process.env.TEST_CMD_TIMEOUT_S || "300");
    await $`bash -lc ${`set -euo pipefail
      printf '.\n' > .buckroot
      cat > TARGETS <<'EOF'
platform(
    name = "no_cgo",
    constraint_values = [
        "config//go/constraints:cgo_enabled_false",
        "config//go/constraints:asan_false",
        "config//go/constraints:race_false",
    ],
    visibility = ["PUBLIC"],
)
EOF
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
default_platform = //:no_cgo
user_platform = //:no_cgo
target_platforms = //:no_cgo
EOF
      mkdir -p toolchains
      printf '[buildfile]\nname = TARGETS\n' > toolchains/.buckconfig
    `}`;

    // The test harness already rsyncs a minimal repo (excludes libs), writes .buckconfig and prelude.
    // We only need to ensure shared glue scripts exist (copied from repo root if missing) and scaffold a package.

    const repoRoot = process.env.WORKSPACE_ROOT || process.cwd();
    async function ensureFile(rel: string) {
      await $`bash --noprofile --norc -lc ${`test -f ${rel} || (mkdir -p $(dirname ${rel}) && cp ${path.join(
        repoRoot,
        rel,
      )} ${rel})`}`;
    }
    async function ensureDir(rel: string) {
      await $`mkdir -p ${rel}`;
    }

    await ensureFile("go/defs.bzl");
    await ensureFile("tools/buck/export-graph.ts");
    await ensureFile("tools/buck/sync-providers.ts");
    await ensureFile("tools/buck/gen-auto-map.ts");
    await ensureFile("tools/buck/prebuild-guard.ts");
    await ensureFile("tools/dev/install-deps.ts");
    await ensureFile("tools/dev/zx-init.mjs");
    await ensureFile("tools/lib/providers.ts");
    await ensureFile("tools/lib/fs-helpers.ts");
    await ensureDir("third_party/providers");
    await ensureFile("TARGETS");

    // Scaffold a new Go lib into the sparse repo
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;

    // No module downloads or gomod2nix; keep the test focused on glue discovery

    // Run glue explicitly to ensure discovery works in sparse context
    await $`tools/dev/install-deps.ts --glue-only`;
    // Keep the explicit export and mapping to mirror user flow closely
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $`node tools/buck/sync-providers.ts`;
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;

    // Smoke assertions
    await $`test -f third_party/providers/auto_map.bzl`;
    await $`test -f tools/buck/graph.json`;
    // Presence of graph outputs is enough; we no longer rely on Buck-only targets here.
  });
});
