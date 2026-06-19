#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("lang-kit: scaffold skeleton files", async () => {
  await runInTemp("lang-kit-smoke", async (tmp, $) => {
    const name = "rust";
    await $`scaf language new ${name} --yes --display_name=Rust`;
    const expectPaths = [
      path.join(tmp, `viberoots/build-tools/tools/nix/templates/${name}.nix`),
      path.join(tmp, `viberoots/build-tools/tools/nix/planner/${name}.nix`),
      path.join(tmp, `${name}/defs.bzl`),
      path.join(tmp, `viberoots/build-tools/tools/buck/providers/${name}.ts`),
      path.join(tmp, `patches/${name}/.gitkeep`),
      path.join(tmp, `build-tools/tools/tests/${name}/contract/basic.test.ts`),
    ];
    for (const p of expectPaths) {
      if (!(await exists(p))) {
        console.error("missing:", p);
        process.exit(2);
      }
    }
  });
});
