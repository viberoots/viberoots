#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio invalid invocation input JSON object", () => {
  test("--in with non-object fails when inputSchema requires object", async () => {
    await runInTemp("jio-invalid-inv", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "noop", inputSchema: { type: "object" } },
        command: {
          package: "io.example",
          exec: "true",
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(path.join(dir, "noop.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      const inv = path.join(tmp, "inv.json");
      await fsp.writeFile(inv, JSON.stringify([1, 2, 3]), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.noop --in ${inv}`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || e);
        if (!/invalid input/i.test(err)) {
          console.error("expected invalid input error for non-object invocation, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to array invocation when schema requires object");
        process.exit(2);
      }
    });
  });
});
