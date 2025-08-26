#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";

describe("json-cli PR1 skeleton", () => {
  test("shows help and version", async () => {
    await runInTemp("json-cli-help", async (_tmp, $) => {
      const help = await $({ stdio: "pipe" })`json-cli --help`;
      if (!String(help.stdout).includes("Usage: json-cli")) {
        console.error("missing Usage in help");
        process.exit(2);
      }
      const ver = await $({ stdio: "pipe" })`json-cli --version`;
      if (!/^\d+\.\d+\.\d+/.test(String(ver.stdout).trim())) {
        console.error("version not semver-like");
        process.exit(2);
      }
    });
  });

  test("resolves root via .json-cli and lists tools", async () => {
    await runInTemp("json-cli-list", async (tmp, $) => {
      const cfgPath = path.join(tmp, ".json-cli");
      await fsp.writeFile(cfgPath, JSON.stringify({ defaultPackage: "io.example" }), "utf8");
      const toolDir = path.join(tmp, "toolspecs");
      await fsp.mkdir(toolDir, { recursive: true });
      const specPath = path.join(toolDir, "demo.tool.json");
      await fsp.writeFile(
        specPath,
        JSON.stringify({
          tool: { name: "demo" },
          command: {
            package: "io.example",
            exec: "echo",
            parameters: {},
            stdoutTransform: { shell: "jq -c .", format: "ndjson" },
          },
        }),
        "utf8",
      );

      const out = await $({ stdio: "pipe" })`json-cli --list`;
      const s = String(out.stdout);
      if (!s.includes("io.example.demo") || !s.includes("demo.tool.json")) {
        console.error("list output missing fqname or path");
        process.exit(2);
      }

      const where = await $({ stdio: "pipe" })`json-cli --where io.example.demo`;
      const p = String(where.stdout).trim();
      if (!p.endsWith("demo.tool.json")) {
        console.error("where did not resolve to demo.tool.json");
        process.exit(2);
      }
    });
  });
});
