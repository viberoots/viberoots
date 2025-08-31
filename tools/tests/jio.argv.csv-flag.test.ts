#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio argv mapping — csv with flag", () => {
  test("array csv renders joined value with equals for flag", async () => {
    await runInTemp("jio-array-csv-flag", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "csv.tool.json");
      const spec = defineToolSpec({
        tool: { name: "csv" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: "printf '%s' '{}'", position: 2 },
            labels: {
              path: "$.labels",
              type: "array",
              flag: true,
              flagName: "--label",
              collectionStyle: "csv",
              csvSeparator: ",",
            },
          },
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      const inPath = path.join(tmp, "in.json");
      await fsp.writeFile(inPath, JSON.stringify({ labels: ["red", "blue"] }), "utf8");
      const planOut = await $({ stdio: "pipe" })`jio io.example.csv --in ${inPath} --dry-run`;
      const plan = JSON.parse(String(planOut.stdout));
      const argv: string[] = plan.argv;
      const token = argv.find((t) => t.startsWith("--label="));
      if (!token || token !== "--label=red,blue") {
        console.error("expected --label=red,blue in argv, got:", argv.join(" "));
        process.exit(2);
      }
    });
  });
});
