#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { scaffoldApp } from "../lib/lang-fixtures";
import { runInTemp } from "../lib/test-helpers";

test("go cli: scaffold and build", async () => {
  // Use a name that avoids triggering dev-shell export in runInTemp (keeps test fast)
  await runInTemp("cli-scaffold-and-build", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await scaffoldApp("go", "demo-cli", { tmp: _tmp, $ });
    // Preflight: ensure Buck sees the new target
    await $({ cwd: _tmp, stdio: "inherit" })`buck2 targets //apps/demo-cli:demo-cli`;
    // Export Buck graph so the planner sees newly scaffolded targets
    await $({
      cwd: _tmp,
      stdio: "inherit",
    })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    // Generate glue and build via Nix graph-generator on the temp repo
    await $({
      env: { ...process.env, INSTALL_DEPS_SKIP_GO_TIDY: "1" },
    })`build-tools/tools/dev/install-deps.ts --glue-only`;
    // Allow direnv in temp repo (non-interactive)
    try {
      await $({ cwd: _tmp, stdio: "pipe" })`direnv allow .`;
    } catch {}
    // Build the specific planner output for the CLI label to ensure its bin is produced
    await $({
      cwd: _tmp,
      stdio: "inherit",
      env: {
        ...process.env,
        BUCK_GRAPH_JSON: path.join(_tmp, "build-tools", "tools", "buck", "graph.json"),
        BUCK_TARGET: "//apps/demo-cli:demo-cli",
      },
    })`nix build ${`path:${_tmp}#graph-generator`} --no-link --accept-flake-config --print-build-logs`;
  });
});
