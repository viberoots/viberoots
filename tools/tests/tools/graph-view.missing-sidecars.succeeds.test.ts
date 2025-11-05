#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("graph-view CLI tolerates missing sidecars (empty indexes)", async () => {
  await runInTemp("graph-view-missing", async (tmp, $) => {
    const graphDir = path.join(tmp, "tools", "buck");
    await fsp.mkdir(graphDir, { recursive: true });
    const nodes = [{ name: "//x:y", rule_type: "phony", labels: [] }];
    await fsp.writeFile(path.join(graphDir, "graph.json"), JSON.stringify(nodes, null, 2));

    const out = await $`node tools/buck/graph-view.ts`;
    const txt = String(out.stdout || "").trim();
    if (!txt) {
      console.error("graph-view produced no output");
      process.exit(2);
    }
    let json: any;
    try {
      json = JSON.parse(txt);
    } catch (e) {
      console.error("graph-view output is not valid JSON\n", txt);
      process.exit(2);
    }
    if (!json || !Array.isArray(json.nodes)) {
      console.error("composite.nodes missing");
      process.exit(2);
    }
    if (typeof json.providerIndex !== "object") {
      console.error("composite.providerIndex missing or wrong type");
      process.exit(2);
    }
    if (typeof json.nodeLockIndex !== "object") {
      console.error("composite.nodeLockIndex missing or wrong type");
      process.exit(2);
    }
  });
});
