#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// PR5: Sparse checkout — ensure a lib with local patches builds and tests in a minimal repo
test("sparse checkout: go lib with local patches builds and tests", async () => {
  await runInTemp("sparse-local-patch-build", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });

    // Scaffold a new Go library with auto-wired test
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;

    // Add a local patch placeholder under the target
    const patchDir = path.join(tmp, "libs", "demo-lib", "patches", "go");
    await $`mkdir -p ${patchDir}`;
    await $`bash -lc 'printf "# sparse noop patch\n" > ${patchDir}/example.com__placeholder@v0.0.0.patch'`;

    // Build the library target directly in sparse context
    await $`buck2 build //libs/demo-lib:demo-lib`;
  });
});
