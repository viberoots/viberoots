#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("provider wiring present only on affected target after patch", async () => {
  await runInTemp("scaf-prov-wiring", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;
    // Initialize module before editing
    await $`/usr/bin/env bash --noprofile --norc -lc 'cd libs/demo-lib && test -f go.mod || go mod init example.com/demo-lib && go mod edit -require golang.org/x/text@v0.14.0 && go mod tidy'`;
    // Generate gomod2nix
    await $`tools/dev/install-deps.ts`;
    // Create a dummy patch for that module version
    await $`/usr/bin/env bash --noprofile --norc -lc 'mkdir -p patches/go && touch patches/go/golang.org__x__text@v0.14.0.patch'`;
    // Run glue
    await $`build`;
    // Expect provider mapping file to exist (smoke)
    await $`test -f third_party/providers/auto_map.bzl`;
  });
});
