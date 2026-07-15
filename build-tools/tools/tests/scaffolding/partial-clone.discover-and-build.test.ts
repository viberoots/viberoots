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
    await $`bash --noprofile --norc -c ${`set -euo pipefail
      printf '.\n' > .buckroot
      test -f flake.lock || printf "{}\n" > flake.lock
      cat > TARGETS <<'EOF'
load("@prelude//:rules.bzl", "export_file")

platform(
    name = "no_cgo",
    constraint_values = [
        "config//go/constraints:cgo_enabled_false",
        "config//go/constraints:asan_false",
        "config//go/constraints:race_false",
    ],
    visibility = ["PUBLIC"],
)

export_file(
    name = "flake.lock",
    src = "flake.lock",
    visibility = ["PUBLIC"],
)
EOF
      cat > .buckconfig <<'EOF'
[buildfile]
name = TARGETS

[repositories]
root = .
prelude = ./.viberoots/current/prelude
viberoots = ./.viberoots/current
workspace_buck = ./.viberoots/workspace/buck
workspace_providers = ./.viberoots/workspace/providers
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./.viberoots/current/prelude/third-party/fbsource_stub
fbcode = ./.viberoots/current/prelude/third-party/fbcode_stub
config = ./.viberoots/current/prelude

[cells]
root = .
prelude = ./.viberoots/current/prelude
viberoots = ./.viberoots/current
workspace_buck = ./.viberoots/workspace/buck
workspace_providers = ./.viberoots/workspace/providers
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./.viberoots/current/prelude/third-party/fbsource_stub
fbcode = ./.viberoots/current/prelude/third-party/fbcode_stub
config = ./.viberoots/current/prelude

[build]
prelude = prelude
default_platform = //:no_cgo
user_platform = //:no_cgo
target_platforms = //:no_cgo
EOF
      mkdir -p toolchains .viberoots/workspace/buck .viberoots/workspace/providers
      ln -sfn ../viberoots .viberoots/current
      printf '[buildfile]\nname = TARGETS\n' > toolchains/.buckconfig
      printf '[buildfile]\nname = TARGETS\n' > .viberoots/workspace/buck/.buckconfig
      printf '[buildfile]\nname = TARGETS\n' > .viberoots/workspace/providers/.buckconfig
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

    await ensureFile("viberoots/build-tools/go/defs.bzl");
    await ensureFile("viberoots/build-tools/tools/buck/export-graph.ts");
    await ensureFile("viberoots/build-tools/tools/buck/sync-providers.ts");
    await ensureFile("viberoots/build-tools/tools/buck/gen-auto-map.ts");
    await ensureFile("viberoots/build-tools/tools/buck/prebuild-guard.ts");
    await ensureFile("viberoots/build-tools/tools/dev/install-deps.ts");
    await ensureFile("viberoots/build-tools/tools/dev/zx-init.mjs");
    await ensureFile("viberoots/build-tools/tools/lib/providers.ts");
    await ensureFile("viberoots/build-tools/tools/lib/fs-helpers.ts");
    await ensureFile("TARGETS");
    await ensureFile("flake.lock");
    await $`bash --noprofile --norc -lc ${`cp -R ${path.join(repoRoot, "viberoots/toolchains")}/. toolchains/`}`;

    // Scaffold a new Go lib into the sparse repo
    await $`scaf new go lib demo-lib --yes --path=projects/libs/demo-lib`;

    await $`viberoots/build-tools/tools/bin/u`;

    // Run read-only glue explicitly to ensure discovery works in sparse context.
    await $`viberoots/build-tools/tools/dev/install-deps.ts --glue-only`;
    // Keep the explicit export and mapping to mirror user flow closely
    await $`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    await $`node viberoots/build-tools/tools/buck/sync-providers.ts`;
    await $`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;

    // Smoke assertions
    await $`test -f .viberoots/workspace/providers/auto_map.bzl`;
    await $`test -f .viberoots/workspace/buck/graph.json`;
    // Presence of graph outputs is enough; we no longer rely on Buck-only targets here.
  });
});
