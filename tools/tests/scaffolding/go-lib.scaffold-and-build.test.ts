#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go lib: scaffold and build+test", async () => {
  await runInTemp("go-lib-scaffold-and-build", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;
    await $`bash -c 'cp ${process.cwd()}/go/defs.bzl go/defs.bzl'`;
    // Verify TARGETS exists
    await $`test -f libs/demo-lib/TARGETS`;
    // Use repo wrappers to ensure prelude and toolchains are wired
    try {
      await $`build //libs/demo-lib:demo-lib_test`;
      await $`buck2 test --target-platforms prelude//platforms:default -v 2 //libs/demo-lib:demo-lib_test`;
    } catch (e) {
      try {
        console.error(String(e.stdout || ""));
      } catch {}
      try {
        console.error(String(e.stderr || ""));
      } catch {}
      throw e;
    }
  });
});
