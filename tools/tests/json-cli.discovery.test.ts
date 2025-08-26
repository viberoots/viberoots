#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";
import { defineToolSpec } from "../json-cli/spec";

describe("json-cli discovery globs/excludes and duplicates", () => {
  test("globs include and exclude control discovery", async () => {
    await runInTemp("json-cli-globs", async (tmp, $) => {
      const cfg = {
        defaultPackage: "io.example",
        globs: ["toolspecs/a/*.tool.json"],
        excludeGlobs: ["**/skip-*.tool.json"],
      };
      await fsp.writeFile(path.join(tmp, ".json-cli"), JSON.stringify(cfg, null, 2), "utf8");

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

      const out = await $({ stdio: "pipe" })`json-cli --list`;
      const s = String(out.stdout);
      if (!s.includes("io.example.one") || s.includes("io.example.two") || s.includes("skip-two")) {
        console.error("glob include/exclude not respected. list=\n" + s);
        process.exit(2);
      }
    });
  });

  test("duplicate FQName errors", async () => {
    await runInTemp("json-cli-dup", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const a = defineToolSpec({
        tool: { name: "dup" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      const b = defineToolSpec({
        tool: { name: "dup" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "a.tool.json"), JSON.stringify(a, null, 2), "utf8");
      await fsp.writeFile(path.join(dir, "b.tool.json"), JSON.stringify(b, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`json-cli --list`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/duplicate tool FQName/i.test(err)) {
          console.error("expected duplicate error, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to duplicate FQName");
        process.exit(2);
      }
    });
  });

  test("bare name without defaultPackage errors", async () => {
    await runInTemp("json-cli-bare", async (tmp, $) => {
      // no defaultPackage in .json-cli
      await fsp.writeFile(path.join(tmp, ".json-cli"), JSON.stringify({}), "utf8");
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
        await $({ stdio: "pipe" })`json-cli tool --dry-run`;
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
