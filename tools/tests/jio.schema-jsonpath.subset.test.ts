#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio JSONPath subset", () => {
  test("JSONPath subset: arrays and wildcards", async () => {
    await runInTemp("jio-jsonpath", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const spec = defineToolSpec({
        tool: { name: "jp" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            ids: { path: "$.ids[0:3]", type: "array", collectionStyle: "repeatArg", position: 2 },
            tags: {
              path: "$.tags[*]",
              type: "array",
              flag: true,
              flagName: "--tag",
              collectionStyle: "repeatFlag",
            },
            both: {
              path: "$['owner','repo']",
              type: "array",
              collectionStyle: "repeatArg",
              position: 3,
            },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      const p = path.join(tmp, "jp.tool.json");
      await fsp.writeFile(p, JSON.stringify(spec, null, 2), "utf8");
      const inv = path.join(tmp, "inv.json");
      await fsp.writeFile(
        inv,
        JSON.stringify({ ids: ["a", "b", "c", "d"], tags: ["x", "y"], owner: "O", repo: "R" }),
        "utf8",
      );
      const out = await $({ stdio: "pipe" })`jio io.example.jp --in ${inv} --dry-run`;
      const plan = JSON.parse(String(out.stdout));
      const argv: string[] = plan.argv;
      if (!argv.includes("a") || !argv.includes("b") || !argv.includes("c")) {
        console.error("slice not applied as expected:", argv);
        process.exit(2);
      }
      if (!argv.includes("--tag=x") || !argv.includes("--tag=y")) {
        console.error("wildcard not applied as expected:", argv);
        process.exit(2);
      }
      if (!(argv.includes("O") && argv.includes("R"))) {
        console.error("property-name union not applied as expected:", argv);
        process.exit(2);
      }
    });
  });
});
