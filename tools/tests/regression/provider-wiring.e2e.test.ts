#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { providerNameForModuleKey } from "../../lib/providers";

test("provider wiring maps module labels to module providers", async () => {
  await runInTemp("provider-wiring-module", async (tmp, $) => {
    const graphPath = path.join(tmp, "tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graphPath));
    const targetName = "//app:bin";
    const modKey = "golang.org/x/net@v0.24.0";
    const nodes = [
      { name: targetName, rule_type: "go_binary", labels: ["lang:go", `module:${modKey}`] },
    ];
    await fs.writeFile(graphPath, JSON.stringify(nodes, null, 2), "utf8");

    await $({
      cwd: tmp,
    })`tools/buck/gen-auto-map.ts --graph ${graphPath} --out third_party/providers/auto_map.bzl`;

    const autoMap = await fs.readFile(path.join(tmp, "third_party/providers/auto_map.bzl"), "utf8");
    const prov = providerNameForModuleKey("golang.org/x/net", "v0.24.0");
    const fq = `"//third_party/providers:${prov}",`;
    if (!autoMap.includes(fq)) {
      console.error("expected provider mapping missing:", fq);
      process.exit(2);
    }
  });
});
