#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio discovery — bare name error", () => {
  test("bare name without defaultPackage errors", async () => {
    await runInTemp("jio-bare", async (tmp, $) => {
      await fsp.writeFile(path.join(tmp, ".jio"), JSON.stringify({}), "utf8");
      const dir = path.join(tmp, "x");
      await fsp.mkdir(dir, { recursive: true });
      const a = defineToolSpec({
        tool: { name: "tool" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "a.tool.json"), JSON.stringify(a, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio tool --dry-run`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/bare name requires .*defaultPackage/i.test(err)) {
          console.error("expected defaultPackage error, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to missing defaultPackage");
        process.exit(2);
      }
    });
  });
});
