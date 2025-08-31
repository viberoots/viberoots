#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio argv mapping — csv with flag separate style", () => {
  test("array csv renders flag and value as separate tokens when flagValueStyle=separate", async () => {
    await runInTemp("jio-array-csv-flag-separate", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "csvsep.tool.json");
      const spec = defineToolSpec({
        tool: { name: "csvsep" },
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
              flagValueStyle: "separate",
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
      const planOut = await $({ stdio: "pipe" })`jio io.example.csvsep --in ${inPath} --dry-run`;
      const plan = JSON.parse(String(planOut.stdout));
      const argv: string[] = plan.argv;
      const idx = argv.indexOf("--label");
      if (idx < 0 || argv[idx + 1] !== "red,blue") {
        console.error("expected --label red,blue as separate tokens, got:", argv.join(" "));
        process.exit(2);
      }
    });
  });
});
