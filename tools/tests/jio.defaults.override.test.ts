#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio parameter defaults — override", () => {
  test("provided values override defaults", async () => {
    await runInTemp("jio-defaults-override", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "over" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {
            a: { path: "$.all", type: "boolean", flag: true, flagName: "-a", default: true },
            l: { path: "$.long", type: "boolean", flag: true, flagName: "-l", default: true },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "over.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      const inputPath = path.join(tmp, "in.json");
      await fsp.writeFile(inputPath, JSON.stringify({ all: false, long: true }), "utf8");
      const out = await $({ stdio: "pipe" })`jio io.example.over --dry-run --in ${inputPath}`;
      const s = String(out.stdout);
      if (!/"argv"\s*:\s*\["-l"\]/.test(s)) {
        console.error("expected only -l in argv after override, got:\n" + s);
        process.exit(2);
      }
    });
  });
});
