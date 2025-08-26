#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";
import { defineToolSpec } from "../json-cli/spec";

describe("json-cli warns on >2^53-1 numbers", () => {
  test("rendering large number triggers stderr warning", async () => {
    await runInTemp("json-cli-num-warn", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const spec = defineToolSpec({
        tool: { name: "large" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            n: { path: "$.big", type: "number", flag: true, flagName: "--num" },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(tmp, "large.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      const inv = path.join(tmp, "inv.json");
      // 2^53 is 9007199254740992 (> 2^53-1)
      await fsp.writeFile(inv, JSON.stringify({ big: 9007199254740992 }), "utf8");
      let warned = false;
      try {
        await $({ stdio: "pipe" })`json-cli io.example.large --in ${inv} --dry-run`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        warned = /warning: number may lose precision/i.test(err);
        // dry-run returns 0, so we'd not normally be here; tolerate either path
      }
      if (!warned) {
        // If no exception path, run again and check captured stderr via spawn output
        const out = await $({ stdio: "pipe" })`json-cli io.example.large --in ${inv} --dry-run`; // should be 0
        const err = String(out.stderr || "");
        if (!/warning: number may lose precision/i.test(err)) {
          console.error("expected precision warning in stderr, got:\n" + err);
          process.exit(2);
        }
      }
    });
  });
});
