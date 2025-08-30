#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio --collect — --in= form", () => {
  test("--in= form is accepted (smoke)", async () => {
    await runInTemp("jio-collect-in-where-equals", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "echo" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            script: {
              type: "string",
              value: "printf '%s' '{\"hello\":\"world\"}'",
              position: 2,
            },
          },
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(path.join(dir, "echo.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      const inv = { hello: "world" };
      const inPath = path.join(tmp, "in.json");
      await fsp.writeFile(inPath, JSON.stringify(inv), "utf8");
      const out = await $({ stdio: "pipe" })`jio io.example.echo --in=${inPath}`;
      const s = String(out.stdout).trim();
      const obj = JSON.parse(s);
      if (obj.hello !== "world") {
        console.error("expected roundtrip json");
        process.exit(2);
      }
    });
  });
});
