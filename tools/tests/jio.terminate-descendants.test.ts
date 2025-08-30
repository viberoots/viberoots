#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio descendant-only termination", () => {
  test("does not kill unrelated sibling process", async () => {
    await runInTemp("jio-terminate-desc", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      // Start unrelated sibling process
      const pidTxt = await $({
        stdio: "pipe",
      })`bash -lc 'nohup sleep 30 >/dev/null 2>&1 & echo $!'`;
      const siblingPid = String(pidTxt.stdout || "").trim();

      // Tool that sleeps long to force timeout
      const spec = defineToolSpec({
        tool: { name: "t" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: "sleep 30", position: 2 },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
          timeoutMs: 500,
        },
      });
      await fsp.writeFile(path.join(tmp, "t.tool.json"), JSON.stringify(spec, null, 2), "utf8");

      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.t`;
      } catch {
        failed = true;
      }
      if (!failed) {
        console.error("expected timeout");
        process.exit(2);
      }
      // Sibling should still be alive (allow brief race before check)
      await $`sleep 0.1`;
      const psRes = await $({ stdio: "pipe" })`bash -lc 'ps -p ${siblingPid} -o pid='`.catch(
        () => ({ stdout: "" }),
      );
      const seen = String(psRes.stdout || "").trim();
      if (!seen) {
        console.error("unrelated sibling process should not be killed by jio timeout");
        process.exit(2);
      }
      // Cleanup sibling
      await $`kill ${siblingPid}`.catch(() => undefined);
    });
  });
});
