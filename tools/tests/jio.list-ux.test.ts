#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";
import { defineToolSpec } from "../jio/spec";

describe("jio list sorting and not-found hints", () => {
  test("--list prints header and sorts FQNames", async () => {
    await runInTemp("jio-list-sort", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "toolspecs");
      await fsp.mkdir(dir, { recursive: true });
      const a = defineToolSpec({
        tool: { name: "b" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      const b = defineToolSpec({
        tool: { name: "a" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "b.tool.json"), JSON.stringify(a, null, 2), "utf8");
      await fsp.writeFile(path.join(dir, "a.tool.json"), JSON.stringify(b, null, 2), "utf8");

      const out = await $({ stdio: "pipe" })`jio --list`;
      const s = String(out.stdout).trim().split(/\n+/);
      if (!s[0].startsWith("defaultPackage:")) {
        console.error("expected defaultPackage header");
        process.exit(2);
      }
      const lines = s.slice(1);
      const fqs = lines.map((l) => l.split(/\s+/)[0]);
      const sorted = [...fqs].sort();
      if (JSON.stringify(fqs) !== JSON.stringify(sorted)) {
        console.error("list not sorted:", fqs);
        process.exit(2);
      }
    });
  });

  test("not-found hint when globs/excludes are set", async () => {
    await runInTemp("jio-notfound-hint", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({
          defaultPackage: "io.example",
          globs: ["sub/*.tool.json"],
          excludeGlobs: ["**/x.tool.json"],
        }),
        "utf8",
      );
      const dir = path.join(tmp, "other");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "x" },
        command: {
          package: "io.example",
          exec: "echo",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "x.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.x --where`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/tool not found/i.test(err) || !/globs\/excludeGlobs/i.test(err)) {
          console.error("expected not-found hint, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure with hint");
        process.exit(2);
      }
    });
  });
});
