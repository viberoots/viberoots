#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerAutoTargetsPath } from "../../lib/workspace-state-paths";
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
    })`node build-tools/tools/buck/sync-providers.ts --lang node`;
    const txt = await fsp.readFile(path.join(tmp, providerAutoTargetsPath("node")), "utf8");
    if (!txt.includes("node_importer_deps")) {
      console.error("expected Node provider header in TARGETS.node.auto");
      process.exit(2);
    }
  });
});
