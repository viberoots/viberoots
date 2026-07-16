#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { externalNodeToolEnv } from "../../lib/external-node-env";
import { nodeOptionsWithoutZxInit, runNodeWithZx } from "../../lib/node-run";
import { runInTemp } from "./test-helpers";

test("external Node tools drop zx-init imports and preserve unrelated options", () => {
  const zxInit = "/tmp/workspace/viberoots/build-tools/tools/dev/zx-init.mjs";
  const inherited = [
    "--max-old-space-size=256",
    `--import ${zxInit}`,
    `--import=${zxInit}`,
    "--trace-warnings",
  ].join(" ");
  assert.equal(nodeOptionsWithoutZxInit(inherited), "--max-old-space-size=256 --trace-warnings");
  assert.equal(
    externalNodeToolEnv({ NODE_OPTIONS: inherited }).NODE_OPTIONS,
    "--max-old-space-size=256 --trace-warnings",
  );
  assert.equal(externalNodeToolEnv({ NODE_OPTIONS: `--import=${zxInit}` }).NODE_OPTIONS, undefined);
});

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
      zxInitPath: path.join(tmp, "viberoots/build-tools/tools/dev/zx-init.mjs"),
      script: okScript,
      args: ["a", "b"],
      env: {
        ...process.env,
        NODE_RUN_OUT: outPath,
        NODE_OPTIONS: [
          "--max-old-space-size=128",
          `--import ${path.join(tmp, "missing/viberoots/build-tools/tools/dev/zx-init.mjs")}`,
          process.env.NODE_OPTIONS || "",
        ]
          .filter(Boolean)
          .join(" "),
      },
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
        zxInitPath: path.join(tmp, "viberoots/build-tools/tools/dev/zx-init.mjs"),
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

test("node-run resolves relative NODE_PATH from child cwd", async () => {
  await runInTemp("node-run-node-path", async (tmp) => {
    const moduleDir = path.join(tmp, "node_modules", ".pnpm", "node_modules", "fixture-module");
    const outPath = path.join(tmp, "node-run-node-path.out");
    const script = path.join(tmp, "node-run-node-path.ts");

    await fsp.mkdir(moduleDir, { recursive: true });
    await fsp.writeFile(
      path.join(moduleDir, "package.json"),
      JSON.stringify({ name: "fixture-module", type: "module", exports: "./index.js" }),
      "utf8",
    );
    await fsp.writeFile(path.join(moduleDir, "index.js"), "export const value = 'ok';\n", "utf8");
    await fsp.writeFile(
      script,
      [
        'import { value } from "fixture-module";',
        'import * as fsp from "node:fs/promises";',
        "await fsp.writeFile(process.env.NODE_RUN_OUT || '', value, 'utf8');",
      ].join("\n") + "\n",
      "utf8",
    );

    await runNodeWithZx({
      cwd: tmp,
      zxInitPath: path.join(tmp, "viberoots/build-tools/tools/dev/zx-init.mjs"),
      script,
      env: {
        ...process.env,
        NODE_PATH: "node_modules/.pnpm/node_modules",
        NODE_RUN_OUT: outPath,
      },
      stdio: "pipe",
    });

    assert.equal(await fsp.readFile(outPath, "utf8"), "ok");
  });
});
