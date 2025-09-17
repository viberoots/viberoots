#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { providerNameForModuleKey } from "../../lib/providers";

test("related patch presence maps target to provider", async () => {
  await runInTemp("minimal-invalidation-related", async (tmp, $) => {
    const graphPath = path.join(tmp, "tools/buck/graph.json");
    const outPath = path.join(tmp, "third_party/providers/auto_map.bzl");
    await fs.mkdirp(path.dirname(graphPath));
    await fs.mkdirp(path.dirname(outPath));

    const target = "//service:bin";
    const related = "golang.org/x/net@v0.24.0";
    const nodes = [
      { name: target, rule_type: "go_binary", labels: ["lang:go", `module:${related}`] },
    ];
    await fs.writeFile(graphPath, JSON.stringify(nodes, null, 2), "utf8");

    // With mapping driven purely by graph labels, presence of a related patch isn't required for the map,
    // but provider naming should match the module key label via providerNameForModuleKey
    await $({ cwd: tmp })`tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${outPath}`;
    const data = await fs.readFile(outPath, "utf8");
    const prov = providerNameForModuleKey("golang.org/x/net", "v0.24.0");
    const fq = `"//third_party/providers:${prov}",`;
    if (!data.includes(fq)) {
      console.error("expected provider present after related change:", fq);
      process.exit(2);
    }
  });
});
