#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";
import { providerNameForModuleKey } from "../../lib/providers";

test("gen-auto-map: module label maps to module provider", async () => {
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
    const pname = providerNameForModuleKey("golang.org/x/net", "v0.24.0");
    const fq = `//third_party/providers:${pname}`;
    if (!out.includes(`"//app:bin": [`)) {
      console.error("missing target key entry");
      process.exit(2);
    }
    if (!out.includes(fq)) {
      console.error("missing module provider entry");
      process.exit(2);
    }
  });
});
