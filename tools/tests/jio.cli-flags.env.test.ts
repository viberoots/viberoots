#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio CLI flags: env passthrough and set", () => {
  test("--clean-env drops vars; --no-clean-env retains, and --env sets", async () => {
    await runInTemp("jio-cli-env", async (tmp, $) => {
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
              value: 'printf "{\\"foo\\":\\"$FOO\\",\\"bar\\":\\"$BAR\\"}"',
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

      const out1 = await $({
        stdio: "pipe",
      })`bash --noprofile --norc -lc ${`FOO=X BAR=Y jio io.example.printenv --clean-env`}`;
      const obj1 = JSON.parse(String(out1.stdout || "{}"));
      if (obj1.foo !== "" || obj1.bar !== "") {
        console.error("expected empty vars with --clean-env");
        process.exit(2);
      }

      const out2 = await $({
        stdio: "pipe",
      })`bash --noprofile --norc -lc ${`FOO=X BAR=Y jio io.example.printenv --no-clean-env --pass-env FOO`}`;
      const obj2 = JSON.parse(String(out2.stdout || "{}"));
      if (obj2.foo !== "X" || obj2.bar !== "Y") {
        console.error("expected all vars retained with --no-clean-env (pass-env ignored)");
        process.exit(2);
      }

      const out3 = await $({
        stdio: "pipe",
      })`bash --noprofile --norc -lc ${`jio io.example.printenv --env FOO=Z --env BAR=W`}`;
      const obj3 = JSON.parse(String(out3.stdout || "{}"));
      if (obj3.foo !== "Z" || obj3.bar !== "W") {
        console.error("expected vars set via --env");
        process.exit(2);
      }
    });
  });
});
