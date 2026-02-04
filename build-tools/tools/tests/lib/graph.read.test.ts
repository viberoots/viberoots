#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("readGraph handles array shape", async () => {
  await runInTemp("graph-read-array", async (tmp, $) => {
    const nodes = [
      { name: "//app:bin", labels: ["module:example.org/mod@v1.0.0"] },
      { name: "//lib:core", labels: [] },
    ];
    const dir = path.join(tmp, "build-tools", "tools", "buck");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "graph.json"), JSON.stringify(nodes), "utf8");
    const { readGraph } = await import("../../lib/graph.ts");
    const list = await readGraph(path.join(dir, "graph.json"));
    if (!Array.isArray(list) || list.length !== 2) {
      console.error("expected two nodes from array graph");
      process.exit(2);
    }
    if (list[0].name !== "//app:bin") {
      console.error("unexpected first node name");
      process.exit(2);
    }
  });
});

test("readGraph handles object-map shape", async () => {
  await runInTemp("graph-read-map", async (tmp, $) => {
    const nodes = {
      a: { name: "//app:bin", labels: ["lockfile:apps/web/pnpm-lock.yaml#apps/web"] },
      b: { name: "//lib:core", labels: ["nixpkg:pkgs.zlib"] },
    } as Record<string, any>;
    const dir = path.join(tmp, "build-tools", "tools", "buck");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "graph.json"), JSON.stringify(nodes), "utf8");
    const { readGraph } = await import("../../lib/graph.ts");
    const list = await readGraph(path.join(dir, "graph.json"));
    if (!Array.isArray(list) || list.length !== 2) {
      console.error("expected two nodes from object-map graph");
      process.exit(2);
    }
    const names = list.map((n) => n.name).sort();
    if (names[0] !== "//app:bin" || names[1] !== "//lib:core") {
      console.error("unexpected node names from object-map");
      process.exit(2);
    }
  });
});
