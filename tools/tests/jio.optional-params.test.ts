#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio optional vs required path parameters", () => {
  test("optional path-mapped params allow omission of --in", async () => {
    await runInTemp("jio-optional", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "opt" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {
            maybe: { path: "$.x", type: "string", position: 1, required: false },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "opt.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      // Should run without --in and produce empty line (echo with no args)
      const out = await $({ stdio: "pipe" })`jio io.example.opt --dry-run`;
      const s = String(out.stdout);
      if (!/"argv"\s*:\s*\[\]/.test(s)) {
        console.error("expected empty argv on dry-run, got:\n" + s);
        process.exit(2);
      }
    });
  });

  test("required path-mapped params force --in", async () => {
    await runInTemp("jio-required", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "req" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {
            needed: { path: "$.x", type: "string", position: 1, required: true },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "req.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.req --dry-run`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || e);
        if (!/--in is required when required parameters use path/.test(err)) {
          console.error("unexpected error:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to missing --in");
        process.exit(2);
      }
    });
  });
});
