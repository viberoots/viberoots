#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerNameForImporter } from "../../lib/providers";
import { runInTemp } from "../lib/test-helpers";

test("gen-auto-map: mixed module+lockfile labels map only lockfile provider (Node-only)", async () => {
  await runInTemp("auto-map-mixed", async (tmp, $) => {
    const node = {
      name: "//svc:api",
      labels: [
        "module:github.com/sirupsen/logrus@v1.9.0",
        "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
      ],
    };
    const graphPath = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    const outPath = path.join(tmp, ".viberoots", "workspace", "providers", "auto_map.bzl");
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(graphPath, JSON.stringify([node]), "utf8");
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${outPath}`;
    const out = await fsp.readFile(outPath, "utf8");
    const lf = `workspace_providers//:${providerNameForImporter(
      "projects/apps/web/pnpm-lock.yaml",
      "projects/apps/web",
    )}`;
    if (!out.includes(lf)) {
      console.error("missing expected lockfile provider in mapping");
      process.exit(2);
    }
    if (out.includes("workspace_providers//:mod_")) {
      console.error("did not expect module provider in mixed mapping");
      process.exit(2);
    }
  });
});
