#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio discovery — duplicate FQName", () => {
  test("duplicate FQName errors", async () => {
    await runInTemp("jio-dup", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const a = defineToolSpec({
        tool: { name: "dup" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      const b = defineToolSpec({
        tool: { name: "dup" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "a.tool.json"), JSON.stringify(a, null, 2), "utf8");
      await fsp.writeFile(path.join(dir, "b.tool.json"), JSON.stringify(b, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio --list`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/duplicate tool FQName/i.test(err)) {
          console.error("expected duplicate error, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to duplicate FQName");
        process.exit(2);
      }
    });
  });
});
