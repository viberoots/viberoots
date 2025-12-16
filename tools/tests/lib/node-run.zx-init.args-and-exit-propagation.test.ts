#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";
import { runNodeWithZx } from "../../lib/node-run.ts";

test("node-run loads zx-init, forwards args, and propagates exit codes", async () => {
  await runInTemp("node-run-helper", async (tmp) => {
    const outPath = path.join(tmp, "node-run.out.json");
    const okScript = path.join(tmp, "node-run.ok.ts");
    const failScript = path.join(tmp, "node-run.fail.ts");

    await fsp.writeFile(
      okScript,
      [
        'import * as fsp from "node:fs/promises";',
        'const out = String(process.env.NODE_RUN_OUT || "");',
        "if (!out) throw new Error('missing NODE_RUN_OUT');",
        "const hasZx = typeof (globalThis).$ === 'function';",
        "await fsp.writeFile(out, JSON.stringify({ hasZx, args: process.argv.slice(2) }), 'utf8');",
        "if (!hasZx) process.exit(3);",
      ].join("\n") + "\n",
      "utf8",
    );

    await fsp.writeFile(failScript, "process.exit(7);\n", "utf8");

    await runNodeWithZx({
      cwd: tmp,
      zxInitPath: path.join(tmp, "tools/dev/zx-init.mjs"),
      script: okScript,
      args: ["a", "b"],
      env: { ...process.env, NODE_RUN_OUT: outPath },
      stdio: "pipe",
    });

    const txt = await fsp.readFile(outPath, "utf8");
    const json = JSON.parse(txt) as { hasZx: boolean; args: string[] };
    assert.equal(json.hasZx, true, "expected zx-init to load zx globals ($)");
    assert.deepEqual(json.args, ["a", "b"]);

    let failed = false;
    try {
      await runNodeWithZx({
        cwd: tmp,
        zxInitPath: path.join(tmp, "tools/dev/zx-init.mjs"),
        script: failScript,
        stdio: "pipe",
      });
    } catch (e: any) {
      failed = true;
      assert.ok(
        String(e?.message || "").includes("exited with code 7"),
        "expected helper to surface the child exit code",
      );
    }
    assert.equal(failed, true, "expected failing child process to reject");
  });
});
