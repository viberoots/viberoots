#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("meta: missing help fails", async () => {
  await runInTemp("tmpl-validate-fail1", async (tmp, _$) => {
    const $ = _$({ stdio: "ignore" });
    const metaPath = path.join(tmp, "tools", "scaffolding", "templates", "go", "lib", "meta.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
    delete (meta as any).help;
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    let failed = false;
    try {
      await $`scaf validate tools/scaffolding/templates/go/lib --quiet`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("validator unexpectedly passed");
      process.exit(2);
    }
  });
});
