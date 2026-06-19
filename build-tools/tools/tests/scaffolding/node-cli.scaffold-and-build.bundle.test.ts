#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsDevTool } from "./lib/viberoots-tools";

// Ensure dev env tooling (yaml parser, zx deps) is exported in temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node cli: build bundled single-file and run help", async () => {
  const prevRoots = process.env.TEST_RSYNC_ROOTS;
  if (!prevRoots) {
    process.env.TEST_RSYNC_ROOTS = "viberoots";
  }
  try {
    await runInTemp("node-cli-bundle", async (tmp, $) => {
      await $`scaf new ts cli demo --yes --skip-lockfile-gen`;
      const targetsPath = path.join(tmp, "projects", "apps", "demo", "TARGETS");
      // Toggle bundle mode with importer param
      await $`node -e ${`const fs=require('fs');
       const p='${targetsPath.replace(/'/g, "'\\''")}';
       let t=fs.readFileSync(p,'utf8');
       t=t.replace('# bundle = True,', 'bundle = True,');
       t=t.replace('# importer = "{{ importer }}",', 'importer = "projects/apps/demo",');
       fs.writeFileSync(p,t,'utf8');`}`;
      // Glue
      await $`zx-wrapper ${viberootsDevTool("install-deps.ts")} --glue-only`;
      await $({
        cwd: tmp,
        stdio: "inherit",
      })`NIX_PNPM_ALLOW_GENERATE=1 node ${viberootsDevTool("update-pnpm-hash.ts")} --lockfile projects/apps/demo/pnpm-lock.yaml`;
      await $({
        cwd: tmp,
        stdio: "inherit",
      })`git add projects/node-modules.hashes.json`;
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
