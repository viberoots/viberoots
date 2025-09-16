#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers: duplicate module@version fails", async () => {
  await runInTemp("sync-dup", async (tmp, $) => {
    const dir = path.join(tmp, "patches", "go");
    await fsp.mkdir(dir, { recursive: true });
    // Use different encodings that decode to the same import path
    await fsp.writeFile(
      path.join(dir, "github.com___acme__widget@v1.2.3.patch"),
      "# one\n",
      "utf8",
    );
    await fsp.writeFile(path.join(dir, "github.com__acme__widget@v1.2.3.patch"), "# two\n", "utf8");
    let failed = false;
    try {
      await $({
        stdio: "pipe",
      })`node tools/buck/sync-providers.ts --out third_party/providers/TARGETS.auto`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected sync-providers to fail on duplicate module key");
      process.exit(2);
    }
  });
});
