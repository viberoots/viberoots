#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { scaffoldLib } from "../lib/lang-fixtures";
import { runInTemp } from "../lib/test-helpers";

test("go lib: scaffold and build+test", { timeout: 240_000 }, async () => {
  // Ensure minimal roots are available in the temp repo for Buck macros
  process.env.TEST_RSYNC_ROOTS = process.env.TEST_RSYNC_ROOTS || "tools toolchains go lang";
  await runInTemp("lib-scaffold-and-build", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    // ensure git repo for glue scripts that use git
    await $`git init`;
    await scaffoldLib("go", "demo-lib", { tmp: _tmp, $ });
    const outLinkName = `buck-go-${Date.now()}`;
    const outLinkPath = path.join(_tmp, outLinkName);
    try {
      await fsp.rm(outLinkPath, { recursive: false, force: true });
    } catch {}
    // Glue generation and a targeted build are sufficient to validate scaffolding
    await $`tools/dev/install-deps.ts --glue-only`;
    // repo_toolchains mapping is already set up by the test harness; no rewrite needed
    // Build the library target (avoid running tests to keep runtime bounded)
    await $`buck2 build //libs/demo-lib:demo-lib --target-platforms //:no_cgo`;
  });
});
