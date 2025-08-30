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

  test("duplicate positional indices fail", async () => {
    await runInTemp("jio-argv-dup-pos", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "dup.tool.json");
      const spec = defineToolSpec({
        tool: { name: "dup" },
        command: {
          package: "io.example",
          exec: "tool",
          parameters: {
            a: { type: "string", value: "A", position: 1 },
            b: { type: "string", value: "B", position: 1 },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.dup --dry-run`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/duplicate positional index/i.test(err)) {
          console.error("expected duplicate positional index error, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to duplicate positional index");
        process.exit(2);
      }
    });
  });

  test("missing mandatory positional index fails", async () => {
    await runInTemp("jio-argv-missing-pos", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "miss.tool.json");
      const spec = defineToolSpec({
        tool: { name: "miss" },
        command: {
          package: "io.example",
          exec: "tool",
          parameters: {
            a: { type: "string", value: "A" },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.miss --dry-run`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/must declare a positive integer position/i.test(err)) {
          console.error("expected missing/invalid position error, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to invalid positional index");
        process.exit(2);
      }
    });
  });
});
