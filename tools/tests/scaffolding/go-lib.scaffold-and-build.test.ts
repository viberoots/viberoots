#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { scaffoldLib } from "../lib/lang-fixtures";
import { runInTemp } from "../lib/test-helpers";

test("go lib: scaffold and build+test", { timeout: 240_000 }, async () => {
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
    // glue and run Buck tests to assert the lib builds/tests successfully
    await $`tools/dev/install-deps.ts --glue-only`;
    // The lib template uses a single library target; run a wildcard to include tests
    await $`buck2 test //libs/demo-lib/...`;
  });
});
