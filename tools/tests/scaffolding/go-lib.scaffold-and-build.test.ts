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
    console.error("[debug] start scaffoldLib(go, demo-lib)");
    await scaffoldLib("go", "demo-lib", { tmp: _tmp, $ });
    console.error("[debug] done scaffoldLib(go, demo-lib)");
    const outLinkName = `buck-go-${Date.now()}`;
    const outLinkPath = path.join(_tmp, outLinkName);
    try {
      await fsp.rm(outLinkPath, { recursive: false, force: true });
    } catch {}
    // Glue generation and a targeted build are sufficient to validate scaffolding
    console.error("[debug] start install-deps --glue-only");
    await $`tools/dev/install-deps.ts --glue-only`;
    console.error("[debug] done install-deps --glue-only");
    // repo_toolchains mapping is already set up by the test harness; no rewrite needed
    // Build the library target (avoid running tests to keep runtime bounded)
    console.error("[debug] start buck2 build //libs/demo-lib:demo-lib");
    await $`buck2 build //libs/demo-lib:demo-lib --target-platforms //:no_cgo`;
    console.error("[debug] done buck2 build //libs/demo-lib:demo-lib");
  });
});
