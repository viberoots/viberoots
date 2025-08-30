#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio argv mapping — arrays and kv", () => {
  test("array separate renders repeated pairs", async () => {
    await runInTemp("jio-array-separate", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "sep.tool.json");
      const spec = defineToolSpec({
        tool: { name: "sep" },
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
              collectionStyle: "separate",
            },
          },
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      const inPath = path.join(tmp, "in.json");
      await fsp.writeFile(inPath, JSON.stringify({ labels: ["red", "blue"] }), "utf8");
      const planOut = await $({ stdio: "pipe" })`jio io.example.sep --in ${inPath} --dry-run`;
      const plan = JSON.parse(String(planOut.stdout));
      const argv: string[] = plan.argv;
      const idx = argv.indexOf("--label");
      if (
        idx < 0 ||
        argv[idx + 1] !== "red" ||
        argv[idx + 2] !== "--label" ||
        argv[idx + 3] !== "blue"
      ) {
        console.error("expected repeated --label red --label blue, got:", argv.join(" "));
        process.exit(2);
      }
    });
  });

  test("JSONPath array for non-array type fails", async () => {
    await runInTemp("jio-array-mismatch", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "bad.tool.json");
      const spec = defineToolSpec({
        tool: { name: "bad" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: "printf '%s' '{}'", position: 2 },
            wrong: { path: "$.labels", type: "string", flag: true, flagName: "--label" },
          },
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      const inPath = path.join(tmp, "in.json");
      await fsp.writeFile(inPath, JSON.stringify({ labels: ["red", "blue"] }), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.bad --in ${inPath} --dry-run`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/expects type string but JSONPath returned an array/i.test(err)) {
          console.error("expected array-mismatch error, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to JSONPath array for non-array type");
        process.exit(2);
      }
    });
  });
});
