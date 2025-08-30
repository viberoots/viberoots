#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

describe("jio schema validation — invalid spec", () => {
  test("invalid spec rejected by schema", async () => {
    await runInTemp("jio-schema", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
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
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.oops --dry-run`;
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
});
