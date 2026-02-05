#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// Ensure dev env tooling (yaml parser, zx deps) is exported in temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node cli: scaffold, build shim, run help", async () => {
  const prevRoots = process.env.TEST_RSYNC_ROOTS;
  if (!prevRoots) {
    process.env.TEST_RSYNC_ROOTS = "build-tools toolchains third_party/providers prelude patches";
  }
  try {
    await runInTemp("node-cli-scaffold-shim", async (_tmp, $) => {
      await $`git init`;
      await $`scaf new node cli demo --yes`;
      // Ensure Buck sees the new target
      await $`buck2 targets //projects/apps/demo:demo`;
      // Glue
      await $`build-tools/tools/dev/install-deps.ts --glue-only`;
      // Ensure Node providers are synced via orchestrator (primary path)
      await $`node build-tools/tools/buck/sync-providers.ts --lang=node`;
      await $`buck2 targets //projects/apps/demo:demo`;
      // Build shim target (default macro mode)
      await $`buck2 build --target-platforms prelude//platforms:default //projects/apps/demo:demo`;
      // Run help
      await $`node projects/apps/demo/bin/demo --help`;
    });
  } finally {
    if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
    else process.env.TEST_RSYNC_ROOTS = prevRoots;
  }
});

test("node cli: build bundled single-file and run help", async () => {
  const prevRoots = process.env.TEST_RSYNC_ROOTS;
  if (!prevRoots) {
    process.env.TEST_RSYNC_ROOTS = "build-tools toolchains third_party/providers prelude patches";
  }
  try {
    await runInTemp("node-cli-bundle", async (tmp, $) => {
      await $`git init`;
      await $`scaf new node cli demo --yes`;
      const targetsPath = path.join(tmp, "projects", "apps", "demo", "TARGETS");
      // Toggle bundle mode with importer param
      await $`node -e ${`const fs=require('fs');
       const p='${targetsPath.replace(/'/g, "'\\''")}';
       let t=fs.readFileSync(p,'utf8');
       t=t.replace('# bundle = True,', 'bundle = True,');
       t=t.replace('# importer = "{{ importer }}",', 'importer = "projects/apps/demo",');
       fs.writeFileSync(p,t,'utf8');`}`;
      // Glue
      await $`build-tools/tools/dev/install-deps.ts --glue-only`;
      await $`node build-tools/tools/buck/sync-providers.ts --lang=node`;
      await $`buck2 targets //projects/apps/demo:demo`;
      // Build bundled artifact via macro (nix build under the hood)
      await $`buck2 build --target-platforms prelude//platforms:default //projects/apps/demo:demo`;
      // Run the bundled artifact and assert help works
      const so =
        await $`buck2 targets --target-platforms prelude//platforms:default --show-output //projects/apps/demo:demo`;
      const line =
        String(so.stdout || "")
          .trim()
          .split(/\r?\n/)
          .find((l) => l.includes("//projects/apps/demo:demo")) || "";
      const outPath = line.split(/\s+/)[1] || "";
      if (!outPath) {
        console.error("could not determine bundled output path from --show-output");
        process.exit(2);
      }
      await $`${outPath} --help`;
    });
  } finally {
    if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
    else process.env.TEST_RSYNC_ROOTS = prevRoots;
  }
});
