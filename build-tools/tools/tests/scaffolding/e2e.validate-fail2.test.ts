#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("meta: empty usage fails", async () => {
  await runInTemp("tmpl-validate-fail2", async (tmp, _$) => {
    const $ = _$({ stdio: "ignore" });
    const metaPath = path.join(
      tmp,
      "viberoots",
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "go",
      "lib",
      "meta.json",
    );
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
    (meta as any).help = { usage: "" };
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    let failed = false;
    try {
      await $`scaf validate viberoots/build-tools/tools/scaffolding/templates/go/lib --quiet`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("validator unexpectedly passed");
      process.exit(2);
    }
  });
});
