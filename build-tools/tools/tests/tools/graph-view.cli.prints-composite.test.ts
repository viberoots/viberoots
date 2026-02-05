#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("graph-view CLI prints composite view with nodes and indexes", async () => {
  await runInTemp("graph-view-cli", async (tmp, $) => {
    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    const provDir = path.join(tmp, "third_party", "providers");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.mkdir(provDir, { recursive: true });

    // Minimal graph with one Node and one non-Node entry
    const nodes = [
      {
        name: "//projects/apps/web:bundle",
        rule_type: "node_bundle",
        labels: [
          "lang:node",
          "kind:bin",
          "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
        ],
      },
      {
        name: "//projects/libs/ui:lib",
        rule_type: "go_library",
        labels: ["lang:go", "kind:lib"],
      },
    ];
    await fsp.writeFile(path.join(graphDir, "graph.json"), JSON.stringify(nodes, null, 2));

    // Provider index (JSON sidecar)
    const providerIndex = {
      "//third_party/providers:lf_deadbeef_projects_apps_web__projects_apps_web_pnpm_lock_yaml": {
        kind: "node",
        key: "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
      },
    };
    await fsp.writeFile(
      path.join(provDir, "provider_index.json"),
      JSON.stringify(providerIndex, null, 2) + "\n",
      "utf8",
    );

    // Node lock index (emitted by exporter in real runs; synthesize here)
    const nodeLockIndex = {
      "//projects/apps/web:bundle": "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
    };
    await fsp.writeFile(
      path.join(graphDir, "node-lock-index.json"),
      JSON.stringify(nodeLockIndex, null, 2) + "\n",
      "utf8",
    );

    const out = await $`node build-tools/tools/buck/graph-view.ts`;
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
    if (!Array.isArray(json.nodes) || json.nodes.length !== 2) {
      console.error("composite.nodes missing or wrong length");
      process.exit(2);
    }
    if (!json.providerIndex || typeof json.providerIndex !== "object") {
      console.error("composite.providerIndex missing");
      process.exit(2);
    }
    if (!json.nodeLockIndex || typeof json.nodeLockIndex !== "object") {
      console.error("composite.nodeLockIndex missing");
      process.exit(2);
    }
    if (
      json.nodeLockIndex["//projects/apps/web:bundle"] !==
      "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"
    ) {
      console.error("nodeLockIndex entry not found or mismatched");
      process.exit(2);
    }
  });
});
