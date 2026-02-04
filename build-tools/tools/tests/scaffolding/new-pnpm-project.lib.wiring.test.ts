#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import fs from "fs-extra";

test("node lib scaffold: TARGETS includes lockfile label and auto_map wires provider", async () => {
  await runInTemp("node-lib-scaffold-wiring", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    // Skip lockfile generation: this test only asserts label wiring and provider mapping generation.
    // The primary lockfile generation path is exercised elsewhere.
    await $`scaf new node lib demo --yes --skip-lockfile-gen`;
    const lockLabel = "lockfile:libs/demo/pnpm-lock.yaml#libs/demo";
    const tPath = path.join(tmp, "libs", "demo", "TARGETS");
    const txt = await fs.readFile(tPath, "utf8");
    if (!txt.includes(lockLabel)) throw new Error("lockfile label missing in TARGETS");

    await fs.outputJson(
      path.join(tmp, "build-tools", "tools", "buck", "graph.json"),
      [
        {
          name: "//libs/demo:demo",
          rule_type: "genrule",
          labels: [lockLabel, "lang:node", "kind:lib"],
        },
      ],
      { spaces: 2 },
    );
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    const autoMap = await fs.readFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "utf8",
    );
    if (!autoMap.includes("//libs/demo:demo"))
      throw new Error("auto_map missing provider mapping for demo");
  });
});
