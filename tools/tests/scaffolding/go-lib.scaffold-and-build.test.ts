#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { scaffoldLib } from "../lib/lang-fixtures";
import { runInTemp } from "../lib/test-helpers";

test("go lib: scaffold and build+test", async () => {
  await runInTemp("go-lib-scaffold-and-build", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await scaffoldLib("go", "demo-lib", { tmp: _tmp, $ });
    const outLinkName = `buck-go-${Date.now()}`;
    const outLinkPath = path.join(_tmp, outLinkName);
    try {
      await fsp.rm(outLinkPath, { recursive: false, force: true });
    } catch {}
    await $({
      cwd: _tmp,
      stdio: "inherit",
    })`nix build .#graph-generator --out-link ${outLinkName}`;
    const manifestPath = path.join(_tmp, outLinkName, "manifest.json");
    await fsp.access(manifestPath);
  });
});
