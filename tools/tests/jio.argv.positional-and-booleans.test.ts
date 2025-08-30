#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio argv mapping + dry-run — positional + booleans", () => {
  test("positional + boolean presence + equals", async () => {
    await runInTemp("jio-argv1", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example", env: { GLOBAL_ENV: "1" } }),
        "utf8",
      );
      const specPath = path.join(tmp, "demo.tool.json");
      const spec = defineToolSpec({
        tool: { name: "flags" },
        command: {
          package: "io.example",
          exec: "tool",
          defaultBooleanStyle: "presence",
          parameters: {
            sub: { type: "string", value: "run", position: 1 },
            dryRun: {
              path: "$.dryRun",
              type: "boolean",
              flag: true,
              flagName: "--dry-run",
              booleanStyle: "equals",
            },
            verbose: {
              path: "$.verbose",
              type: "boolean",
              flag: true,
              flagName: "--verbose",
            },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      const inv = path.join(tmp, "inv.json");
      await fsp.writeFile(inv, JSON.stringify({ dryRun: true, verbose: false }), "utf8");
      const out = await $({ stdio: "pipe" })`jio io.example.flags --in ${inv} --dry-run`;
      const plan = JSON.parse(String(out.stdout));
      if (plan.exec !== "tool") {
        console.error("unexpected exec");
        process.exit(2);
      }
      const argv: string[] = plan.argv;
      const expect = ["run", "--dry-run=true"];
      if (!argv.includes(expect[0]) || !argv.includes(expect[1])) {
        console.error("argv mismatch: ", argv);
        process.exit(2);
      }
      if (!Array.isArray(plan.envKeys) || plan.envKeys.length === 0) {
        console.error("envKeys missing in plan");
        process.exit(2);
      }
    });
  });
});
