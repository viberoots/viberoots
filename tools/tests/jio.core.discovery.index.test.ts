#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { buildIndex, readRootConfig } from "../../tools/jio/core/index.ts";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio core — discovery index", () => {
  test("indexes fqnames and detects duplicates", async () => {
    await runInTemp("jio-core-disc", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const aPath = path.join(tmp, "a.tool.json");
      const bPath = path.join(tmp, "nested", "b.tool.json");
      await fsp.mkdir(path.dirname(bPath), { recursive: true });
      const specA = defineToolSpec({
        tool: { name: "demo" },
        command: {
          package: "io.example",
          exec: "tool",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      const specB = defineToolSpec({
        tool: { name: "other" },
        command: {
          package: "io.example",
          exec: "tool",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(aPath, JSON.stringify(specA, null, 2), "utf8");
      await fsp.writeFile(bPath, JSON.stringify(specB, null, 2), "utf8");
      const cfg = await readRootConfig(tmp);
      const idx = await buildIndex(tmp, cfg as any);
      const keys = Array.from(idx.keys()).sort();
      const expect = ["io.example.demo", "io.example.other"];
      const ok = expect.every((k) => keys.includes(k));
      if (!ok) {
        console.error("index mismatch:", keys);
        process.exit(2);
      }

      // Duplicate
      const dupPath = path.join(tmp, "dup.tool.json");
      await fsp.writeFile(dupPath, JSON.stringify(specA, null, 2), "utf8");
      let failed = false;
      try {
        await buildIndex(tmp, cfg as any);
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (!/duplicate tool FQName/i.test(msg)) {
          console.error("expected duplicate error, got:", msg);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to duplicate fqname");
        process.exit(2);
      }
    });
  });
});
