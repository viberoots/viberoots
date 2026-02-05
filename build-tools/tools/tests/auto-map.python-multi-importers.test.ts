#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerNameForImporter } from "../lib/providers.ts";
import { runInTemp } from "./lib/test-helpers";

test("gen-auto-map: Python two importers map to distinct providers", async () => {
  await runInTemp("auto-map-python-multi", async (tmp, $) => {
    const graphPath = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });

    // Two python targets, each labeled with its own importer-scoped uv.lock
    const t1 = {
      name: "//projects/apps/pytool1:lib",
      rule_type: "python_library",
      labels: [
        "lang:python",
        "kind:lib",
        "lockfile:projects/apps/pytool1/uv.lock#projects/apps/pytool1",
      ],
      srcs: [],
      deps: [],
    };
    const t2 = {
      name: "//projects/apps/pytool2:lib",
      rule_type: "python_library",
      labels: [
        "lang:python",
        "kind:lib",
        "lockfile:projects/apps/pytool2/uv.lock#projects/apps/pytool2",
      ],
      srcs: [],
      deps: [],
    };
    await fsp.writeFile(graphPath, JSON.stringify([t1, t2], null, 2), "utf8");

    const outPath = path.join(tmp, "third_party", "providers", "auto_map.bzl");
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${outPath}`;
    const out = await fsp.readFile(outPath, "utf8");

    // Keys present (allow optional Buck config suffix)
    const key1 = /"\/\/projects\/apps\/pytool1:lib(?: \(config\/\/platforms:[^)]+\))?": \[/m;
    const key2 = /"\/\/projects\/apps\/pytool2:lib(?: \(config\/\/platforms:[^)]+\))?": \[/m;
    assert.ok(key1.test(out), "expected mapping for //projects/apps/pytool1:lib");
    assert.ok(key2.test(out), "expected mapping for //projects/apps/pytool2:lib");

    // Providers present and distinct
    const p1 = `//third_party/providers:${providerNameForImporter(
      "projects/apps/pytool1/uv.lock",
      "projects/apps/pytool1",
    )}`;
    const p2 = `//third_party/providers:${providerNameForImporter(
      "projects/apps/pytool2/uv.lock",
      "projects/apps/pytool2",
    )}`;
    assert.ok(out.includes(p1), `expected provider ${p1}`);
    assert.ok(out.includes(p2), `expected provider ${p2}`);
    assert.notEqual(p1, p2, "providers for distinct importers must differ");
  });
});
