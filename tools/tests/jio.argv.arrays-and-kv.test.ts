#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio argv mapping + dry-run — arrays and kv", () => {
  test("arrays: repeatArg / repeatFlag / csv; object kv", async () => {
    await runInTemp("jio-argv2", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "arr.tool.json");
      const spec = defineToolSpec({
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
      const out = await $({ stdio: "pipe" })`jio io.example.arr --in ${inv} --dry-run`;
      const plan = JSON.parse(String(out.stdout));
      const argv: string[] = plan.argv;
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
