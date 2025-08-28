#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";
import { defineToolSpec } from "../jio/spec";

describe("jio limits and clean env", () => {
  test("argv tokens cap triggers exit 78", async () => {
    await runInTemp("jio-argv-cap", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "argvcap" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: "true", position: 2 },
            many: {
              type: "array",
              flag: true,
              flagName: "-n",
              collectionStyle: "repeatFlag",
              path: "$.many",
              required: true,
            },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "argvcap.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      const inPath = path.join(tmp, "in.json");
      await fsp.writeFile(inPath, JSON.stringify({ many: [1, 2, 3, 4, 5] }), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.argvcap --in=${inPath} --max-argv-tokens 3`;
      } catch (e: any) {
        const err = String(e?.stderr || e);
        if (!/argv tokens limit exceeded/i.test(err)) {
          console.error("expected argv tokens limit exceeded, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to argv tokens cap");
        process.exit(2);
      }
    });
  });

  test("stdin bytes cap triggers exit 78", async () => {
    await runInTemp("jio-stdin-cap", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "sink" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: { sub: { type: "string", value: "-lc", position: 1 }, cmd: { type: "string", value: "cat >/dev/null", position: 2 } },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "sink.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      const big = "A".repeat(2000);
      let failed = false;
      try {
        await $({ stdio: "pipe" })`bash --noprofile --norc -lc ${`printf %s ${big} | jio io.example.sink --max-stdin-bytes 100`}`;
      } catch (e: any) {
        const err = String(e?.stderr || e);
        if (!/stdin bytes limit exceeded/i.test(err)) {
          console.error("expected stdin bytes limit exceeded, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to stdin cap");
        process.exit(2);
      }
    });
  });

  test("stdout JSON bytes cap triggers exit 78", async () => {
    await runInTemp("jio-stdout-json-cap", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const payload = "A".repeat(200);
      const spec = defineToolSpec({
        tool: { name: "bigjson" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: `printf '{"x":"${payload}"}'`, position: 2 },
          },
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(path.join(dir, "bigjson.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.bigjson --max-stdout-json-bytes 100`;
      } catch (e: any) {
        const err = String(e?.stderr || e);
        if (!/stdout JSON bytes limit exceeded/i.test(err)) {
          console.error("expected stdout JSON limit exceeded, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to stdout json cap");
        process.exit(2);
      }
    });
  });

  test("ndjson line bytes cap triggers exit 78", async () => {
    await runInTemp("jio-ndjson-line-cap", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const payload = "A".repeat(200);
      const spec = defineToolSpec({
        tool: { name: "bigline" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: `printf '{"x":"${payload}"}\n'`, position: 2 },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "bigline.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.bigline --max-ndjson-line-bytes 100`;
      } catch (e: any) {
        const err = String(e?.stderr || e);
        if (!/ndjson line bytes limit exceeded/i.test(err)) {
          console.error("expected ndjson line bytes limit exceeded, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to ndjson line cap");
        process.exit(2);
      }
    });
  });

  test("clean env by default; pass-env enables specific vars", async () => {
    await runInTemp("jio-clean-env", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "printenv" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: 'printf "{\\"foo\\":\\"$FOO\\"}"', position: 2 },
          },
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(path.join(dir, "printenv.tool.json"), JSON.stringify(spec, null, 2), "utf8");

      // FOO set in caller, but not passed by default
      const out1 = await $({ stdio: "pipe" })`bash --noprofile --norc -lc ${`FOO=BAR jio io.example.printenv`}`;
      const obj1 = JSON.parse(String(out1.stdout || "{}"));
      if (obj1.foo !== "") {
        console.error("expected empty foo without pass-env");
        process.exit(2);
      }

      const out2 = await $({ stdio: "pipe" })`bash --noprofile --norc -lc ${`FOO=BAR jio io.example.printenv --pass-env FOO`}`;
      const obj2 = JSON.parse(String(out2.stdout || "{}"));
      if (obj2.foo !== "BAR") {
        console.error("expected foo=BAR with pass-env");
        process.exit(2);
      }
    });
  });
});


