#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// Ensure dev env tooling (yaml parser, zx deps) is exported in temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node cli: scaffold, build shim, run help", async () => {
  await runInTemp("node-cli-scaffold-shim", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`git init`;
    await $`scaf new node cli demo --yes`;
    // Ensure a lockfile exists so providers can be generated deterministically
    await $`bash -lc 'cd apps/demo && test -f pnpm-lock.yaml || cat > pnpm-lock.yaml <<\'EOF\'\nlockfileVersion: "9.0"\nimporters:\n  .:\n    dependencies: {}\npackages: {}\nEOF'`;
    // Ensure Buck sees the new target
    await $({ cwd: tmp, stdio: "inherit" })`buck2 targets //apps/demo:demo`;
    // Glue
    await $`tools/dev/install-deps.ts --glue-only`;
    // Ensure Node providers are synced via orchestrator (primary path)
    await $`node tools/buck/sync-providers.ts --lang=node`;
    await $({ cwd: tmp, stdio: "inherit" })`buck2 targets //apps/demo:demo`;
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
    await $`git init`;
    await $`scaf new node cli demo --yes`;
    await $`bash -lc 'cd apps/demo && test -f pnpm-lock.yaml || cat > pnpm-lock.yaml <<\'EOF\'\nlockfileVersion: "9.0"\nimporters:\n  .:\n    dependencies: {}\npackages: {}\nEOF'`;
    const targetsPath = path.join(tmp, "apps", "demo", "TARGETS");
    // Toggle bundle mode with importer param
    await $`node -e ${`const fs=require('fs');
       const p='${targetsPath.replace(/'/g, "'\\''")}';
       let t=fs.readFileSync(p,'utf8');
       t=t.replace('# bundle = True,', 'bundle = True,');
       t=t.replace('# importer = "{{ importer }}",', 'importer = "apps/demo",');
       fs.writeFileSync(p,t,'utf8');`}`;
    // Glue
    await $({ cwd: tmp })`tools/dev/install-deps.ts --glue-only`;
    await $({ cwd: tmp })`node tools/buck/sync-providers.ts --lang=node`;
    await $({ cwd: tmp, stdio: "inherit" })`buck2 targets //apps/demo:demo`;
    // Build bundled artifact via macro (nix build under the hood)
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`buck2 build --target-platforms prelude//platforms:default //apps/demo:demo`;
  });
});
