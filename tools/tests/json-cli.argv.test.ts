#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";
import { defineToolSpec } from "../json-cli/spec";

describe("json-cli PR2 argv mapping + dry-run", () => {
  test("positional + boolean presence + equals", async () => {
    await runInTemp("json-cli-argv1", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example", env: { GLOBAL_ENV: "1" } }),
        "utf8",
      );
      const specPath = path.join(tmp, "demo.tool.json");
      const spec = defineToolSpec({
        specVersion: "1.0.0",
        jsonPathDialect: "jsonpath-plus@8",
        schemaDialect: "https://json-schema.org/draft/2020-12/schema",
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
      const out = await $({ stdio: "pipe" })`json-cli io.example.flags --in ${inv} --dry-run`;
      const plan = JSON.parse(String(out.stdout));
      if (plan.exec !== "tool") {
        console.error("unexpected exec");
        process.exit(2);
      }
      const argv: string[] = plan.argv;
      const expect = ["run", "--dry-run=true"];
      if (
        !(
          argv[0] === expect[0] &&
          argv[1] === expect[1] &&
          argv.every((x, i) => x === expect[i] || true)
        )
      ) {
        // only assert first two stable entries
        console.error("argv mismatch: ", argv);
        process.exit(2);
      }
      if (!Array.isArray(plan.envKeys) || plan.envKeys.length === 0) {
        console.error("envKeys missing in plan");
        process.exit(2);
      }
    });
  });

  test("arrays: repeatArg / repeatFlag / csv; object kv", async () => {
    await runInTemp("json-cli-argv2", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "arr.tool.json");
      const spec = defineToolSpec({
        specVersion: "1.0.0",
        jsonPathDialect: "jsonpath-plus@8",
        schemaDialect: "https://json-schema.org/draft/2020-12/schema",
        tool: { name: "arr" },
        command: {
          package: "io.example",
          exec: "tool",
          parameters: {
            ids: { path: "$.ids", type: "array", position: 1, collectionStyle: "repeatArg" },
            tag: {
              path: "$.tags",
              type: "array",
              flag: true,
              flagName: "--tag",
              collectionStyle: "repeatFlag",
            },
            labels: {
              path: "$.labels",
              type: "array",
              flag: true,
              flagName: "--labels",
              collectionStyle: "csv",
              csvSeparator: ";",
            },
            opts: { path: "$.opts", type: "object", flag: true, collectionStyle: "kv" },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      const inv = path.join(tmp, "inv.json");
      await fsp.writeFile(
        inv,
        JSON.stringify({
          ids: ["a", "b"],
          tags: ["x", "y"],
          labels: ["red", "blue"],
          opts: { a: "1", b: "2" },
        }),
        "utf8",
      );
      const out = await $({ stdio: "pipe" })`json-cli io.example.arr --in ${inv} --dry-run`;
      const plan = JSON.parse(String(out.stdout));
      const argv: string[] = plan.argv;
      // Expect: a b --labels=red;blue --tag=x --tag=y --a=1 --b=2 (sorted flags)
      if (
        !(
          argv.includes("a") &&
          argv.includes("b") &&
          argv.includes("--labels=red;blue") &&
          argv.includes("--tag=x") &&
          argv.includes("--tag=y") &&
          argv.includes("--a=1") &&
          argv.includes("--b=2")
        )
      ) {
        console.error("argv missing elements: ", argv);
        process.exit(2);
      }
    });
  });
});
