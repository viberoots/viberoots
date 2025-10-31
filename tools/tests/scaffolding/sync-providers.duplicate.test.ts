#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers: ignores non-Node patches; generates Node header without error", async () => {
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
    await $({
      stdio: "pipe",
    })`node tools/buck/sync-providers.ts --out third_party/providers/TARGETS.auto`;
    const txt = await fsp.readFile(
      path.join(tmp, "third_party", "providers", "TARGETS.auto"),
      "utf8",
    );
    if (!txt.includes('load("//third_party/providers:defs_node.bzl", "node_importer_deps")')) {
      console.error("expected Node provider header in TARGETS.auto");
      process.exit(2);
    }
  });
});
