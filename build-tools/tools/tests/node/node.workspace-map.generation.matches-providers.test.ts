#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_NODE_WORKSPACE_MAP_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("workspace map generation matches providers", async () => {
  await runInTemp("node-workspace-map-gen", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "web");
    const libDir = path.join(tmp, "projects", "libs", "ui");
    await fs.mkdirp(appDir);
    await fs.mkdirp(libDir);
    await fs.writeJson(path.join(appDir, "package.json"), { name: "@repo/web", version: "0.0.0" });
    await fs.writeJson(path.join(libDir, "package.json"), { name: "@repo/ui", version: "0.0.0" });

    const nodes = [
      {
        name: "//projects/apps/web:web",
        rule_type: "js_binary",
        labels: [
          "lang:node",
          "kind:app",
          "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
        ],
      },
      {
        name: "//projects/libs/ui:ui",
        rule_type: "js_library",
        labels: [
          "lang:node",
          "kind:lib",
          "lockfile:projects/libs/ui/pnpm-lock.yaml#projects/libs/ui",
        ],
      },
      {
        name: "//projects/libs/ui:unit",
        rule_type: "js_test",
        labels: [
          "lang:node",
          "kind:test",
          "lockfile:projects/libs/ui/pnpm-lock.yaml#projects/libs/ui",
        ],
      },
    ];
    const sim = path.join(tmp, "build-tools", "tools", "buck", "simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");
    await $({ cwd: tmp })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${sim}`;
    await $({ cwd: tmp })`node viberoots/build-tools/tools/buck/gen-provider-index.ts`;
    await $({ cwd: tmp })`node viberoots/build-tools/tools/node/gen-workspace-map.ts`;

    assert.equal(DEFAULT_NODE_WORKSPACE_MAP_PATH, ".viberoots/workspace/node/workspace-map.json");
    const outPath = path.join(tmp, DEFAULT_NODE_WORKSPACE_MAP_PATH);
    const got = await fs.readJson(outPath);
    assert.deepEqual(got, {
      "@repo/ui": "//projects/libs/ui:ui",
      "@repo/web": "//projects/apps/web:web",
    });
    await assert.rejects(
      fs.lstat(path.join(tmp, "build-tools", "tools", "node", "workspace-map.json")),
    );
  });
});
