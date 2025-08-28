#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../json-cli/spec";
import { runInTemp } from "./lib/test-helpers";

describe("json-cli formal schema validation and JSONPath subset", () => {
  test("invalid spec rejected by schema", async () => {
    await runInTemp("json-cli-schema", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const bad = {
        tool: { name: "oops" },
        command: {
          package: "io.example",
          /* missing exec */ parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
        specVersion: "1.0.0",
      };
      await fsp.writeFile(path.join(tmp, "bad.tool.json"), JSON.stringify(bad, null, 2), "utf8");
      // Execute the bad tool directly to trigger schema validation failure
      let failed = false;
      try {
        await $({ stdio: "pipe" })`json-cli io.example.oops --dry-run`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/invalid spec|invalid .*missing command\.exec/i.test(err)) {
          console.error("expected invalid spec message, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to schema validation");
        process.exit(2);
      }
    });
  });

  test("JSONPath subset: arrays and wildcards", async () => {
    await runInTemp("json-cli-jsonpath", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
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
            ids: { path: "$.ids[0:3]", type: "array", collectionStyle: "repeatArg" },
            tags: {
              path: "$.tags[*]",
              type: "array",
              flag: true,
              flagName: "--tag",
              collectionStyle: "repeatFlag",
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
        JSON.stringify({ ids: ["a", "b", "c", "d"], tags: ["x", "y"] }),
        "utf8",
      );
      const out = await $({ stdio: "pipe" })`json-cli io.example.jp --in ${inv} --dry-run`;
      const plan = JSON.parse(String(out.stdout));
      const argv: string[] = plan.argv;
      // Expect positionals: -lc a b c ; flags: --tag=x --tag=y
      if (
        !(
          argv.includes("a") &&
          argv.includes("b") &&
          argv.includes("c") &&
          argv.includes("--tag=x") &&
          argv.includes("--tag=y")
        )
      ) {
        console.error("jsonpath subset not applied as expected:", argv);
        process.exit(2);
      }
    });
  });
});
