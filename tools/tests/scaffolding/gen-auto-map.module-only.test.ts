#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("gen-auto-map: Go module labels do not map to providers (Node-only)", async () => {
  await runInTemp("auto-map-module", async (tmp, $) => {
    const node = { name: "//app:bin", labels: ["module:golang.org/x/net@v0.24.0"] };
    await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "tools", "buck", "graph.json"),
      JSON.stringify([node]),
      "utf8",
    );
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    const out = await fsp.readFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "utf8",
    );
    if (out.includes(`"//app:bin": [`)) {
      console.error("did not expect target key entry for module-only labels");
      process.exit(2);
    }
  });
});
