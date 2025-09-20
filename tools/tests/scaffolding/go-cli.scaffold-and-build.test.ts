#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go cli: scaffold and build", async () => {
  await runInTemp("go-cli-scaffold-and-build", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go cli demo-cli --yes --path=apps/demo-cli`;
    await $`bash -c 'cp ${process.cwd()}/go/defs.bzl go/defs.bzl'`;
    // Generate glue and build
    await $`build`;
    // Verify TARGETS exists
    await $`test -f apps/demo-cli/TARGETS`;
    await $`build //apps/demo-cli:demo-cli`;
    await $`test -s apps/demo-cli/go.mod`;
  });
});
