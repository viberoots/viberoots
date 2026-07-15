#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCommand } from "../../dev/filtered-flake-command";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("filtered flake commands capture concurrent child output without executor pipes on Darwin", async () => {
  const results = await Promise.all(
    Array.from(
      { length: 4 },
      async (_, index) =>
        await runCommand({
          command: process.execPath,
          args: [
            "-e",
            `process.stdout.write("out-${index}"); process.stderr.write("err-${index}")`,
          ],
        }),
    ),
  );

  assert.deepEqual(
    results.map(({ exitCode, stdout, stderr }) => ({ exitCode, stdout, stderr })),
    Array.from({ length: 4 }, (_, index) => ({
      exitCode: 0,
      stdout: `out-${index}`,
      stderr: `err-${index}`,
    })),
  );

  await assert.rejects(
    runCommand({
      command: process.execPath,
      args: [
        "-e",
        'process.stdout.write("failure-out"); process.stderr.write("failure-err"); process.exit(7)',
      ],
    }),
    (error: Error & { exitCode?: number; stdout?: string; stderr?: string }) => {
      assert.equal(error.exitCode, 7);
      assert.equal(error.stdout, "failure-out");
      assert.equal(error.stderr, "failure-err");
      assert.match(error.message, /failure-out/);
      assert.match(error.message, /failure-err/);
      return true;
    },
  );

  await assert.rejects(
    runCommand({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 50,
    }),
    /timed out after 50ms/,
  );
});

test(
  "filtered flake command timeouts terminate the owned descendant process group",
  { skip: process.platform === "win32" },
  async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "filtered-command-timeout-"));
    const pidFile = path.join(tmp, "descendant.pid");
    try {
      await assert.rejects(
        runCommand({
          command: process.execPath,
          args: [
            "-e",
            [
              'const { spawn } = require("node:child_process")',
              'const fs = require("node:fs")',
              'const child = spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\", () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" })',
              "fs.writeFileSync(process.argv[1], String(child.pid))",
              'process.on("SIGTERM", () => {})',
              "setInterval(() => {}, 1000)",
            ].join(";"),
            pidFile,
          ],
          timeoutMs: 10_000,
          killGraceMs: 100,
        }),
        /timed out after 10000ms/,
      );
      const descendantPid = Number(await fsp.readFile(pidFile, "utf8"));
      assert.ok(Number.isFinite(descendantPid) && descendantPid > 1);
      assert.throws(() => process.kill(descendantPid, 0));
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  },
);

test(
  "filtered flake command watchdog terminates its group after owner death",
  { skip: process.platform === "win32" },
  async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "filtered-command-owner-death-"));
    const pidFile = path.join(tmp, "child.pid");
    const moduleUrl = pathToFileURL(
      path.join(root, "build-tools/tools/dev/filtered-flake-command.ts"),
    ).href;
    const zxInit = path.join(root, "build-tools/tools/dev/zx-init.mjs");
    const ownerScript = [
      `import { runCommand } from ${JSON.stringify(moduleUrl)}`,
      `await runCommand({ command: process.execPath, args: ["-e", ${JSON.stringify(
        [
          'const fs = require("node:fs")',
          "fs.writeFileSync(process.argv[1], String(process.pid))",
          'process.on("SIGTERM", () => {})',
          "setInterval(() => {}, 1000)",
        ].join(";"),
      )}, ${JSON.stringify(pidFile)}] })`,
    ].join(";");
    const owner = spawn(
      process.execPath,
      ["--experimental-strip-types", "--import", zxInit, "--input-type=module", "-e", ownerScript],
      {
        cwd: root,
        env: {
          ...process.env,
          TMPDIR: tmp,
          FILTERED_FLAKE_COMMAND_WATCHDOG_GRACE_SEC: "1",
        },
        stdio: "ignore",
      },
    );
    try {
      await waitFor(
        async () =>
          await fsp
            .access(pidFile)
            .then(() => true)
            .catch(() => false),
        5_000,
      );
      const childPid = Number(await fsp.readFile(pidFile, "utf8"));
      owner.kill("SIGKILL");
      await waitFor(async () => {
        try {
          process.kill(childPid, 0);
          return false;
        } catch {
          return true;
        }
      }, 5_000);
      await waitFor(
        async () =>
          (await snapshotEntries(path.join(tmp, "viberoots-command.noindex"))).filter((entry) =>
            entry.startsWith("vbr-command-"),
          ).length === 0,
        5_000,
      );
    } finally {
      owner.kill("SIGKILL");
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  },
);

async function snapshotEntries(dir: string): Promise<string[]> {
  return await fsp.readdir(dir).catch(() => []);
}

test("filtered flake command clears timeout before asynchronous capture reading", async () => {
  const source = await fsp.readFile(
    path.join(root, "build-tools/tools/dev/filtered-flake-command.ts"),
    "utf8",
  );
  const closeIndex = source.indexOf('proc.on("close"');
  const clearIndex = source.indexOf("clearTimeout(timer)", closeIndex);
  const asyncReadIndex = source.indexOf("void (async () =>", closeIndex);
  assert.ok(closeIndex >= 0 && clearIndex > closeIndex && clearIndex < asyncReadIndex);
  assert.match(source.slice(closeIndex, asyncReadIndex), /const closedTimedOut = timedOut/);
});

test("filtered flake command stops its watchdog through a private control pipe", async () => {
  const source = await fsp.readFile(
    path.join(root, "build-tools/tools/dev/filtered-flake-command.ts"),
    "utf8",
  );
  assert.match(source, /read -r -t 1 _ <&3/);
  assert.match(source, /control\?\.end\("stop\\n"\)/);
  assert.doesNotMatch(source, /process\.kill\(watchdogPid/);
});
