#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";
import { providerNameForImporter } from "../lib/providers.ts";

test("gen-auto-map: Python lockfile label maps to importer-scoped provider; unlabeled target skipped", async () => {
  await runInTemp("auto-map-python-lockfile", async (tmp, $) => {
    const graphPath = path.join(tmp, "tools", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    // Synthesize two targets in the exported graph:
    // - a Python target with a uv.lock importer-scoped label
    // - an unlabeled target that should not appear in auto_map
    const pyTarget = {
      name: "//apps/pytool:lib",
      rule_type: "python_library",
      labels: ["lang:python", "kind:lib", "lockfile:apps/pytool/uv.lock#apps/pytool"],
      srcs: [],
      deps: [],
    };
    const unlabeled = {
      name: "//apps/pytool:unlabeled",
      rule_type: "python_library",
      labels: ["lang:python", "kind:lib"],
      srcs: [],
      deps: [],
    };
    await fsp.writeFile(graphPath, JSON.stringify([pyTarget, unlabeled], null, 2), "utf8");

    // Generate auto_map from the synthetic graph
    const outPath = path.join(tmp, "third_party", "providers", "auto_map.bzl");
    await $`node tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${outPath}`;

    const out = await fsp.readFile(outPath, "utf8");

    // Expect a key for the labeled Python target. Allow optional Buck config suffix.
    const keyRegex = /"\/\/apps\/pytool:lib(?: \(config\/\/platforms:[^)]+\))?": \[/m;
    assert.ok(keyRegex.test(out), "expected mapping key for //apps/pytool:lib in auto_map.bzl");

    // Expect the importer-scoped provider derived from the uv.lock label
    const expectedProvider = `//third_party/providers:${providerNameForImporter(
      "apps/pytool/uv.lock",
      "apps/pytool",
    )}`;
    assert.ok(
      out.includes(expectedProvider),
      `expected provider ${expectedProvider} in auto_map.bzl`,
    );

    // Ensure unlabeled target does not get a mapping entry
    assert.ok(
      !out.includes('"//apps/pytool:unlabeled"'),
      "did not expect mapping for unlabeled target",
    );
  });
});
