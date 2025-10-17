#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node cli: scaffold, build shim, run help", async () => {
  await runInTemp("node-cli-scaffold-shim", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`scaf new node cli demo --yes`;
    // Ensure Buck sees the new target
    await $({ cwd: tmp, stdio: "inherit" })`buck2 targets //apps/demo:demo`;
    // Glue
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $`node tools/buck/sync-providers-node.ts`;
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    // Build shim target (default macro mode)
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`buck2 build --target-platforms prelude//platforms:default //apps/demo:demo`;
    // Run help
    await $({ cwd: path.join(tmp, "apps", "demo"), stdio: "inherit" })`node bin/demo --help`;
  });
});

test("node cli: build bundled single-file and run help", async () => {
  await runInTemp("node-cli-bundle", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`scaf new node cli demo --yes`;
    const targetsPath = path.join(tmp, "apps", "demo", "TARGETS");
    // Toggle bundle mode with importer param
    await $`node -e ${`const fs=require('fs');
       const p='${targetsPath.replace(/'/g, "'\\''")}';
       let t=fs.readFileSync(p,'utf8');
       t=t.replace('# bundle = True,', 'bundle = True,');
       t=t.replace('# importer = "{{ importer }}",', 'importer = "apps/demo",');
       fs.writeFileSync(p,t,'utf8');`}`;
    // Glue
    await $({ cwd: tmp })`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $({ cwd: tmp })`node tools/buck/sync-providers-node.ts`;
    await $({
      cwd: tmp,
    })`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    // Build bundled artifact via macro (nix build under the hood)
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`buck2 build --target-platforms prelude//platforms:default //apps/demo:demo`;
  });
});
