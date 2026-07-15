#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("scaf go test: lib auto-wires *_test.go under pkg/**", async () => {
  // Avoid dev env export path
  await runInTemp("scaf-test-lib", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });
    // ensure git repo for glue scripts that use git
    await $`git init`;
    // Scaffold a Go library
    await $`scaf new go lib demo-lib --yes --path=projects/libs/demo-lib`;
    // Use scaf to create a new test under pkg/**
    const testPath = path.join(tmp, "projects/libs/demo-lib/pkg/demo-lib/extra_case_test.go");
    await $`scaf new go test extra_case --path=${testPath}`;
    await $`viberoots/build-tools/tools/bin/u`;

    // Glue and test
    await $`viberoots/build-tools/tools/dev/install-deps.ts --glue-only`;
    // Run tests; platform is set by runInTemp's .buckconfig
    await $`buck2 test //projects/libs/demo-lib:demo-lib_test --target-platforms //:no_cgo`;
  });
});
