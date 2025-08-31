#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

// Tests for environment glob passthrough (runner.ts 994..1014)
describe("jio env glob passthrough", () => {
  test("--pass-env AWS_* passes matching env vars", async () => {
    await runInTemp("jio-env-glob-pass", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "printenv" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: {
              type: "string",
              value: 'printf "{\\"a\\":\\"$AWS_X\\",\\"b\\":\\"$AWS_Y\\"}"',
              position: 2,
            },
          },
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(
        path.join(dir, "printenv.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );

      const out = await $({
        stdio: "pipe",
      })`bash --noprofile --norc -lc ${`AWS_X=VX AWS_Y=VY jio io.example.printenv --no-clean-env --pass-env AWS_*`}`;
      const obj = JSON.parse(String(out.stdout || "{}"));
      if (obj.a !== "VX" || obj.b !== "VY") {
        console.error("expected env vars to pass via glob, got:", obj);
        process.exit(2);
      }
    });
  });
});
