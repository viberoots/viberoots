#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../json-cli/spec";
import { runInTemp } from "./lib/test-helpers";

describe("json-cli spawn failure diagnostics", () => {
  test("exec ENOENT produces exit 69 and message", async () => {
    await runInTemp("json-cli-spawn-exec-enoent", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const spec = defineToolSpec({
        tool: { name: "enoent" },
        command: {
          package: "io.example",
          exec: "/no/such/binary-xyz",
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(
        path.join(tmp, "enoent.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      let failed = false;
      try {
        await $({ stdio: "pipe" })`json-cli io.example.enoent`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/failed to spawn exec/i.test(err) || !/69/.test(err)) {
          console.error("expected spawn exec error 69, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to ENOENT");
        process.exit(2);
      }
    });
  });

  test("stdinTransform spawn failure produces exit 69", async () => {
    await runInTemp("json-cli-spawn-stdin", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const spec = defineToolSpec({
        tool: { name: "badstdinspawn" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: { sub: { type: "string", value: "-lc", position: 1 } },
          // Force spawn error by executing a clearly missing interpreter in shell
          stdinTransform: { shell: "exec /no/such/transform-binary", format: "ndjson" },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(
        path.join(tmp, "badstdinspawn.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      let failed = false;
      try {
        await $({ stdio: "pipe" })`json-cli io.example.badstdinspawn`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/failed to spawn stdinTransform/i.test(err) || !/69/.test(err)) {
          console.error("expected spawn stdinTransform error 69, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to stdinTransform spawn failure");
        process.exit(2);
      }
    });
  });
});
