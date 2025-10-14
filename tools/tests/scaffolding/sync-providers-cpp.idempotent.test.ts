#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-cpp: second run is a no-op when inputs unchanged", async () => {
  await runInTemp("cpp-idem", async (tmp, $) => {
    // Minimal graph with one nixpkg label to trigger provider generation
    const nodes = [{ name: "//apps/a:bin", labels: ["lang:cpp", "nixpkg:pkgs.zlib"] }];
    await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "tools", "buck", "graph.json"),
      JSON.stringify(nodes),
      "utf8",
    );

    const outFile = path.join(tmp, "third_party", "providers", "TARGETS.cpp.auto");

    await $`node tools/buck/sync-providers.ts --lang cpp`;
    const before = await fsp.readFile(outFile, "utf8");

    // Second run should not modify the file contents
    await $`node tools/buck/sync-providers.ts --lang cpp`;
    const after = await fsp.readFile(outFile, "utf8");

    if (before !== after) {
      console.error("TARGETS.cpp.auto changed on second run (should be no-op)");
      process.exit(2);
    }
  });
});
