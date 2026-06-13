#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerNameForImporter } from "../lib/providers";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_GRAPH_PATH,
  workspaceProviderLabel,
} from "../lib/workspace-state-paths";
import { runInTemp } from "./lib/test-helpers";

test("gen-auto-map: Python lockfile label maps to importer-scoped provider; unlabeled target skipped", async () => {
  await runInTemp("auto-map-python-lockfile", async (tmp, $) => {
    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    // Synthesize two targets in the exported graph:
    // - a Python target with a uv.lock importer-scoped label
    // - an unlabeled target that should not appear in auto_map
    const pyTarget = {
      name: "//projects/apps/pytool:lib",
      rule_type: "python_library",
      labels: [
        "lang:python",
        "kind:lib",
        "lockfile:projects/apps/pytool/uv.lock#projects/apps/pytool",
      ],
      srcs: [],
      deps: [],
    };
    const unlabeled = {
      name: "//projects/apps/pytool:unlabeled",
      rule_type: "python_library",
      labels: ["lang:python", "kind:lib"],
      srcs: [],
      deps: [],
    };
    await fsp.writeFile(graphPath, JSON.stringify([pyTarget, unlabeled], null, 2), "utf8");

    // Generate auto_map from the synthetic graph
    const outPath = path.join(tmp, DEFAULT_AUTO_MAP_PATH);
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${outPath}`;

    const out = await fsp.readFile(outPath, "utf8");

    // Expect a key for the labeled Python target. Allow optional Buck config suffix.
    const keyRegex = /"\/\/projects\/apps\/pytool:lib(?: \(config\/\/platforms:[^)]+\))?": \[/m;
    assert.ok(
      keyRegex.test(out),
      "expected mapping key for //projects/apps/pytool:lib in auto_map.bzl",
    );

    // Expect the importer-scoped provider derived from the uv.lock label
    const expectedProvider = workspaceProviderLabel(
      providerNameForImporter("projects/apps/pytool/uv.lock", "projects/apps/pytool"),
    );
    assert.ok(
      out.includes(expectedProvider),
      `expected provider ${expectedProvider} in auto_map.bzl`,
    );

    // Ensure unlabeled target does not get a mapping entry
    assert.ok(
      !out.includes('"//projects/apps/pytool:unlabeled"'),
      "did not expect mapping for unlabeled target",
    );
  });
});
