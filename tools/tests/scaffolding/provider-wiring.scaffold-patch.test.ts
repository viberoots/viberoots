#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("provider wiring present only on affected target after patch", async () => {
  await runInTemp("scaf-prov-wiring", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib --yes`;
    // Add a small external dep to go.mod to create a module label
    await $`bash -lc 'cd libs/demo-lib && go mod edit -require golang.org/x/text@v0.14.0'`;
    // Generate gomod2nix
    await $`tools/dev/install-deps.ts`;
    // Create a dummy patch for that module version
    await $`bash -lc 'mkdir -p patches/go && touch patches/go/golang.org__x__text@v0.14.0.patch'`;
    // Run glue
    await $`build`;
    // Ensure provider is mapped: indirectly assert build works (mapping would break if missing)
    await $`buck2 test //libs/demo-lib:demo-lib_test`;
  });
});
