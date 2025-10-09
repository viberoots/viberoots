#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("export-graph writes tools/buck/graph.json and parses", async () => {
  await runInTemp("export-graph", async (tmp, $) => {
    // Ensure temp repo has a valid Buck mapping to the checked-in prelude
    await $({ cwd: tmp })`bash -lc ${`set -euo pipefail
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
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    const p = path.join(tmp, "tools", "buck", "graph.json");
    const txt = await fsp.readFile(p, "utf8");
    const nodes = JSON.parse(txt);
    if (!Array.isArray(nodes)) {
      console.error("expected nodes array in graph.json");
      process.exit(2);
    }
  });
});
