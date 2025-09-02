#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { discoverResources, type ResourceSpec } from "../jio/core/index.ts";
import { runInTemp } from "./lib/test-helpers";

describe("resources discovery (relative paths)", () => {
  test("loads resource specs and resolves file relative to spec dir", async () => {
    await runInTemp("resources-discovery", async (tmp, $) => {
      // Layout: tmp/a/thing.md and tmp/a/meta/my.resource.json that points to ../a/thing.md
      const fileDir = path.join(tmp, "a");
      await fsp.mkdir(fileDir, { recursive: true });
      const target = path.join(fileDir, "thing.md");
      await fsp.writeFile(target, "hello", "utf8");

      const metaDir = path.join(tmp, "a", "meta");
      await fsp.mkdir(metaDir, { recursive: true });
      const specPath = path.join(metaDir, "sample.resource.json");
      const spec: ResourceSpec = {
        id: "sample.thing",
        name: "Sample Thing",
        description: "A sample resource",
        file: "../thing.md",
        mimeType: "text/markdown",
      } as any;
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const { index, warnings } = await discoverResources(tmp);
      if (warnings.length) {
        console.error("unexpected warnings:", warnings);
        process.exit(2);
      }
      const r = index.get("sample.thing");
      if (!r) {
        console.error("resource not discovered");
        process.exit(2);
      }
      if (r.absFilePath !== path.resolve(fileDir, "thing.md")) {
        console.error("absFilePath wrong", {
          got: r.absFilePath,
          want: path.resolve(fileDir, "thing.md"),
        });
        process.exit(2);
      }
      if (r.specPath !== specPath) {
        console.error("specPath wrong", { got: r.specPath, want: specPath });
        process.exit(2);
      }
    });
  });

  test("duplicate ids error", async () => {
    await runInTemp("resources-dup", async (tmp, $) => {
      await fsp.mkdir(path.join(tmp, "d1"), { recursive: true });
      await fsp.mkdir(path.join(tmp, "d2"), { recursive: true });
      const s1 = path.join(tmp, "d1", "one.resource.json");
      const s2 = path.join(tmp, "d2", "two.resource.json");
      await fsp.writeFile(
        s1,
        JSON.stringify({ id: "dup.id", name: "A", file: "../a.txt" }, null, 2),
        "utf8",
      );
      await fsp.writeFile(
        s2,
        JSON.stringify({ id: "dup.id", name: "B", file: "../b.txt" }, null, 2),
        "utf8",
      );
      let threw = false;
      try {
        await discoverResources(tmp);
      } catch {
        threw = true;
      }
      if (!threw) {
        console.error("expected duplicate id error");
        process.exit(2);
      }
    });
  });
});
