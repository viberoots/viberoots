#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import fs from "fs-extra";
import { runInTemp } from "../lib/test-helpers";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node lib: nix_node_test target passes when no tests present", async () => {
  await runInTemp("node-lib-nix-node-test", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`git init`;
    // Scaffold with test target enabled
    await $`scaf new node lib demo --yes --includeNodeTests=true`;

    // Guard: if buck2 prelude input isn't available in this environment, skip
    const preludeCheck =
      await $`nix eval --raw .#inputs.buck2.outPath --accept-flake-config`.nothrow();
    if (preludeCheck.exitCode !== 0) {
      console.log("SKIP: buck2 input unavailable; run inside the dev shell with Nix access");
      return;
    }

    // Remove any sample tests so the runner passes with no matches
    await fs.remove(path.join(tmp, "libs", "demo", "test"));

    // Minimal lockfile so provider sync can run deterministically
    await $`bash -lc 'cd libs/demo && test -f pnpm-lock.yaml || cat > pnpm-lock.yaml <<'\''EOF'\''\nlockfileVersion: "9.0"\nimporters:\n  .:\n    dependencies: {}\npackages: {}\nEOF'`;

    // Glue and provider mapping
    await $`tools/dev/install-deps.ts --glue-only`;
    await $`node tools/buck/sync-providers.ts --lang=node`;

    // Target should exist and test should pass (no tests matched → success)
    await $({
      stdio: "inherit",
    })`buck2 targets --target-platforms prelude//platforms:default //libs/demo:unit`;
    await $({
      stdio: "inherit",
    })`buck2 test --target-platforms prelude//platforms:default //libs/demo:unit`;
  });
});
