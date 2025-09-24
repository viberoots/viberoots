#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go cli: scaffold and build", async () => {
  await runInTemp("go-cli-scaffold-and-build", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`bash -lc ${`set -euo pipefail
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
    await $`scaf new go cli demo-cli --yes --path=apps/demo-cli`;
    // Ensure CLI module has a tidy go.sum for gomod2nix
    await $({ cwd: path.join(_tmp, "apps", "demo-cli"), stdio: "inherit" })`go mod tidy`;
    // Generate gomod2nix from CLI module and copy lockfile to repo root (authoritative)
    await $({ cwd: _tmp, stdio: "inherit" })`tools/bin/gomod2nix --dir apps/demo-cli`;
    await fsp.copyFile(
      path.join(_tmp, "apps", "demo-cli", "gomod2nix.toml"),
      path.join(_tmp, "gomod2nix.toml"),
    );
    // Preflight: ensure Buck sees the new target
    await $({ cwd: _tmp, stdio: "inherit" })`buck2 targets //apps/demo-cli:demo-cli`;
    // Export Buck graph so the planner sees newly scaffolded targets
    await $({
      cwd: _tmp,
      stdio: "inherit",
    })`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    // Generate glue and build via Nix graph-generator on the temp repo
    await $`tools/dev/install-deps.ts --glue-only`;
    // Allow direnv in temp repo (non-interactive)
    try {
      await $({ cwd: _tmp, stdio: "pipe" })`direnv allow .`;
    } catch {}
    // Build the specific planner output for the CLI label to ensure its bin is produced
    await $({
      cwd: _tmp,
      stdio: "inherit",
      env: { ...process.env, BUCK_GRAPH_JSON: path.join(_tmp, "tools", "buck", "graph.json") },
    })`BUCK_TARGET="//apps/demo-cli:demo-cli" nix build .#graph-generator`;
  });
});
