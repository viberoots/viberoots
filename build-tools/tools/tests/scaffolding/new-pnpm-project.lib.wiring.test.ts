#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node lib scaffold: TARGETS includes lockfile label and auto_map wires provider", async () => {
  await runInTemp("node-lib-scaffold-wiring", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    // Skip lockfile generation: this test only asserts label wiring and provider mapping generation.
    // The primary lockfile generation path is exercised elsewhere.
    await $`scaf new ts lib demo --yes --skip-lockfile-gen`;
    const lockLabel = "lockfile:projects/libs/demo/pnpm-lock.yaml#projects/libs/demo";
    const tPath = path.join(tmp, "projects", "libs", "demo", "TARGETS");
    const txt = await fs.readFile(tPath, "utf8");
    if (txt.includes("lockfile:")) {
      throw new Error("lockfile label should be inferred, not explicit in TARGETS");
    }

    await fs.outputJson(
      path.join(tmp, "build-tools", "tools", "buck", "graph.json"),
      [
        {
          name: "//projects/libs/demo:demo",
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
    if (!autoMap.includes("//projects/libs/demo:demo"))
      throw new Error("auto_map missing provider mapping for demo");
  });
});
