#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";

describe("json-cli skips invalid specs with warning", () => {
  test("--list prints warning and continues", async () => {
    await runInTemp("json-cli-invalid-skip", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const good = {
        tool: { name: "ok" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
        specVersion: "1.0.0",
      };
      const bad = {
        tool: { name: "bad" },
        command: {
          package: "io.example",
          /* missing exec */ parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
        specVersion: "1.0.0",
      };
      await fsp.writeFile(path.join(tmp, "good.tool.json"), JSON.stringify(good, null, 2), "utf8");
      await fsp.writeFile(path.join(tmp, "bad.tool.json"), JSON.stringify(bad, null, 2), "utf8");
      const out = await $({ stdio: "pipe" })`json-cli --list`;
      const stdout = String(out.stdout);
      const stderr = String(out.stderr);
      if (!/io\.example\.ok/.test(stdout)) {
        console.error("expected good tool in list");
        process.exit(2);
      }
      if (!/invalid spec skipped/.test(stderr)) {
        console.error("expected warning about invalid spec; stderr=\n" + stderr);
        process.exit(2);
      }
    });
  });
});
