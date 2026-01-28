#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("workspace map generation matches providers", async () => {
  await runInTemp("node-workspace-map-gen", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "web");
    const libDir = path.join(tmp, "libs", "ui");
    await fs.mkdirp(appDir);
    await fs.mkdirp(libDir);
    await fs.writeJson(path.join(appDir, "package.json"), { name: "@repo/web", version: "0.0.0" });
    await fs.writeJson(path.join(libDir, "package.json"), { name: "@repo/ui", version: "0.0.0" });

    const nodes = [
      {
        name: "//apps/web:web",
        rule_type: "js_binary",
        labels: ["lang:node", "kind:app", "lockfile:apps/web/pnpm-lock.yaml#apps/web"],
      },
      {
        name: "//libs/ui:ui",
        rule_type: "js_library",
        labels: ["lang:node", "kind:lib", "lockfile:libs/ui/pnpm-lock.yaml#libs/ui"],
      },
      {
        name: "//libs/ui:unit",
        rule_type: "js_test",
        labels: ["lang:node", "kind:test", "lockfile:libs/ui/pnpm-lock.yaml#libs/ui"],
      },
    ];
    const sim = path.join(tmp, "tools", "buck", "simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");
    await $({ cwd: tmp })`tools/buck/export-graph.ts --simulate ${sim}`;
    await $({ cwd: tmp })`node tools/buck/gen-provider-index.ts`;
    await $({ cwd: tmp })`node tools/node/gen-workspace-map.ts`;

    const outPath = path.join(tmp, "tools", "node", "workspace-map.json");
    const got = await fs.readJson(outPath);
    assert.deepEqual(got, {
      "@repo/ui": "//libs/ui:ui",
      "@repo/web": "//apps/web:web",
    });
  });
});
