#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio --collect mode", () => {
  test("--in= form is accepted (smoke)", async () => {
    await runInTemp("jio-collect-in-where-equals", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "echo" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            script: {
              type: "string",
              value: "printf '%s' '{\"hello\":\"world\"}'",
              position: 2,
            },
          },
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(path.join(dir, "echo.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      const inv = { hello: "world" };
      const inPath = path.join(tmp, "in.json");
      await fsp.writeFile(inPath, JSON.stringify(inv), "utf8");
      const out = await $({ stdio: "pipe" })`jio io.example.echo --in=${inPath}`;
      const s = String(out.stdout).trim();
      const obj = JSON.parse(s);
      if (obj.hello !== "world") {
        console.error("expected roundtrip json");
        process.exit(2);
      }
    });
  });

  test("--where= form is accepted and prints a path", async () => {
    await runInTemp("jio-where-equals", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "x" },
        command: { package: "io.example", exec: "bash", parameters: {} },
      });
      const p = path.join(dir, "x.tool.json");
      await fsp.writeFile(p, JSON.stringify(spec, null, 2), "utf8");
      const out = await $({ stdio: "pipe" })`jio --where=io.example.x`;
      const printed = String(out.stdout).trim();
      if (!printed.endsWith("x.tool.json")) {
        console.error("expected path to spec file");
        process.exit(2);
      }
    });
  });
  test("collect gathers ndjson items into one array", async () => {
    await runInTemp("jio-collect", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "emit3" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            script: {
              type: "string",
              value: "printf '%s\n' '{\"i\":1}' '{\"i\":2}' '{\"i\":3}'",
              position: 2,
            },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "emit3.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      const out = await $({ stdio: "pipe" })`jio io.example.emit3 --collect`;
      const s = String(out.stdout).trim();
      const arr = JSON.parse(s);
      if (!Array.isArray(arr) || arr.length !== 3) {
        console.error("expected array of 3");
        process.exit(2);
      }
    });
  });

  test("collect limit exceeded fails", async () => {
    await runInTemp("jio-collect-limit", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "many" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            script: {
              type: "string",
              value: "for i in $(seq 1 5); do echo '{\"i\":'$i'}'; done",
              position: 2,
            },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "many.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.many --collect --collect-limit 3`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || e);
        if (!/collect-limit/i.test(err)) {
          console.error("expected collect-limit error, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to collect limit");
        process.exit(2);
      }
      // also verify --collect-limit= form
      let failedEq = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.many --collect --collect-limit=2`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || e);
        if (!/collect-limit/i.test(err)) {
          console.error("expected collect-limit error (eq form), got:\n" + err);
          process.exit(2);
        }
        failedEq = true;
      }
      if (!failedEq) {
        console.error("expected failure due to collect limit (= form)");
        process.exit(2);
      }
    });
  });
});
