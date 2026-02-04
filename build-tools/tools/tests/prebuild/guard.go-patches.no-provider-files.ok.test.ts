#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: Go patches present but no Go provider/index files — ok", async () => {
  await runInTemp("guard-go-no-provider-files", async (tmp, $) => {
    // Synthesize a Go patch under global patches/go (no provider files emitted)
    const goPatchDir = path.join(tmp, "patches/go");
    await fsp.mkdir(goPatchDir, { recursive: true });
    await fsp.writeFile(
      path.join(goPatchDir, "golang.org__x__net@v0.24.0.patch"),
      "diff --git a/x b/x\n",
      "utf8",
    );

    // Minimal required glue presence
    await fsp.mkdir(path.join(tmp, "third_party/providers"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "build-tools", "tools", "buck", "graph.json"), "[]", "utf8");
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "node-lock-index.json"),
      "{}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "invalidation-report.txt"),
      "# invalidation-report\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "third_party/providers/auto_map.bzl"),
      "# generated\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );

    // Ensure Buck mapping exists in temp repo
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
      printf '[buildfile]\\nname = TARGETS\\n' > toolchains/.buckconfig
    `}`;

    // Should pass without requiring Go TARGETS.go.auto or provider_index files
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/buck/prebuild-guard.ts`;
  });
});
