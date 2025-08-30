#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio discovery — globs include/exclude", () => {
  test("globs include and exclude control discovery", async () => {
    await runInTemp("jio-globs", async (tmp, $) => {
      const cfg = {
        defaultPackage: "io.example",
        globs: ["toolspecs/a/*.tool.json"],
        excludeGlobs: ["**/skip-*.tool.json"],
      };
      await fsp.writeFile(path.join(tmp, ".jio"), JSON.stringify(cfg, null, 2), "utf8");

      const dirA = path.join(tmp, "toolspecs", "a");
      const dirB = path.join(tmp, "toolspecs", "b");
      await fsp.mkdir(dirA, { recursive: true });
      await fsp.mkdir(dirB, { recursive: true });

      const specA1 = defineToolSpec({
        tool: { name: "one" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      const specA2 = defineToolSpec({
        tool: { name: "skip-me" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      const specB1 = defineToolSpec({
        tool: { name: "two" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });

      await fsp.writeFile(
        path.join(dirA, "one.tool.json"),
        JSON.stringify(specA1, null, 2),
        "utf8",
      );
      await fsp.writeFile(
        path.join(dirA, "skip-two.tool.json"),
        JSON.stringify(specA2, null, 2),
        "utf8",
      );
      await fsp.writeFile(
        path.join(dirB, "two.tool.json"),
        JSON.stringify(specB1, null, 2),
        "utf8",
      );

      const out = await $({ stdio: "pipe" })`jio --list`;
      const s = String(out.stdout);
      if (!s.includes("io.example.one") || s.includes("io.example.two") || s.includes("skip-two")) {
        console.error("glob include/exclude not respected. list=\n" + s);
        process.exit(2);
      }
    });
  });
});
