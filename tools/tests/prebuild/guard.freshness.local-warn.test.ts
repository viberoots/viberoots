#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: local auto-fix runs when stale", async () => {
  await runInTemp("prebuild-fresh-local", async (tmp, $) => {
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "tools", "buck", "graph.json"), "[]", "utf8");
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "# generated\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "TARGETS.auto"),
      "# generated\n",
      "utf8",
    );
    // Touch an input to be newer than outputs
    await fsp.writeFile(path.join(tmp, "TARGETS"), "# touch\n", "utf8");
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts`;
  });
});
