#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerNameForImporter } from "../../lib/providers";
import { runInTemp } from "../lib/test-helpers";

test("gen-auto-map: skips provider-package nodes (no self-entries)", async () => {
  await runInTemp("auto-map-skip-provider-pkg", async (tmp, $) => {
    // Synthesize a graph containing:
    // 1) A provider-package node that would otherwise map to itself
    // 2) A normal target node with a lockfile label
    const providerNode = {
      name: "workspace_providers//:lf_dummy_importer__projects_apps_web_pnpm_lock_yaml",
      labels: ["nixpkg:pkgs.zlib"], // any supported mapping label; shouldn't produce a key due to skip
    };
    const normalNode = {
      name: "//svc:api",
      labels: ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],
    };
    const graphPath = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(graphPath, JSON.stringify([providerNode, normalNode]), "utf8");

    const outPath = path.join(tmp, ".viberoots", "workspace", "providers", "auto_map.bzl");
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${outPath}`;
    const out = await fsp.readFile(outPath, "utf8");

    // Assert no keys for provider-package nodes
    if (/"workspace_providers\/\/:.*": \[/.test(out)) {
      console.error("expected no MODULE_PROVIDERS entries for provider-package nodes");
      process.exit(2);
    }
    // Assert normal node still maps its expected provider
    const expectedProv = `workspace_providers//:${providerNameForImporter(
      "projects/apps/web/pnpm-lock.yaml",
      "projects/apps/web",
    )}`;
    if (!out.includes(`"//svc:api": [`)) {
      console.error('missing mapping key for normal node "//svc:api"');
      process.exit(2);
    }
    if (!out.includes(expectedProv)) {
      console.error("missing expected provider mapping for normal node", expectedProv);
      process.exit(2);
    }
  });
});
