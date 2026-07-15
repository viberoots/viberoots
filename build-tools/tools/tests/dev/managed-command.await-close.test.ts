import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runManagedCommand, type ManagedCommandActivity } from "../../lib/managed-command";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForChildReady(activity: ManagedCommandActivity): Promise<void> {
  const deadline = Date.now() + 2_000;
  while ((!activity.childPid || activity.lastEventSnippet !== "ready") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(activity.childPid, "managed child did not start");
  assert.equal(activity.lastEventSnippet, "ready", "managed child did not install its signal trap");
}

test("managed command waits for child close and inherited output pipes", async () => {
  const started = Date.now();
  const result = await runManagedCommand({
    command: "bash",
    args: ["--noprofile", "--norc", "-c", "(sleep 0.2; printf late) & exit 0"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "late");
  assert.ok(Date.now() - started >= 150, "managed command resolved before child pipes closed");
});

test("parent SIGTERM waits for owned child close and reports interruption", async () => {
  const activity: ManagedCommandActivity = {
    startedAtMs: Date.now(),
    lastOutputAtMs: 0,
    lastEventSnippet: "",
    stdoutBytes: 0,
    stderrBytes: 0,
  };
  const pending = runManagedCommand({
    command: "bash",
    args: [
      "--noprofile",
      "--norc",
      "-c",
      "trap 'sleep 0.1; printf stopped; exit 0' TERM; printf 'ready\\n'; while :; do sleep 1; done",
    ],
    activity,
  });
  await waitForChildReady(activity);
  process.kill(process.pid, "SIGTERM");
  const result = await pending;
  assert.equal(result.interrupted, true);
  assert.match(result.stdout, /stopped/);
});

test("managed command stops its watchdog through a private control pipe", async () => {
  const source = await fsp.readFile(
    path.join(root, "build-tools/tools/lib/managed-command.ts"),
    "utf8",
  );
  assert.match(source, /read -r -t 2 _ <&3/);
  assert.match(source, /control\?\.end\("stop\\n"\)/);
  assert.doesNotMatch(source, /process\.kill\(watchdogPid/);
});

test(
  "managed command watchdog terminates its group after owner death",
  { skip: process.platform === "win32" },
  async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "managed-command-owner-death-"));
    const pidFile = path.join(tmp, "child.pid");
    const moduleUrl = pathToFileURL(
      path.join(root, "build-tools/tools/lib/managed-command.ts"),
    ).href;
    const zxInit = path.join(root, "build-tools/tools/dev/zx-init.mjs");
    const childScript = [
      'const fs = require("node:fs")',
      "fs.writeFileSync(process.argv[1], String(process.pid))",
      'process.on("SIGTERM", () => {})',
      "setInterval(() => {}, 1000)",
    ].join(";");
    const ownerScript = [
      `import { runManagedCommand } from ${JSON.stringify(moduleUrl)}`,
      `await runManagedCommand({ command: process.execPath, args: ["-e", ${JSON.stringify(
        childScript,
      )}, ${JSON.stringify(pidFile)}], killGraceMs: 100 })`,
    ].join(";");
    const owner = spawn(
      process.execPath,
      ["--experimental-strip-types", "--import", zxInit, "--input-type=module", "-e", ownerScript],
      { cwd: root, stdio: "ignore" },
    );
    let childPid = 0;
    try {
      await waitFor(
        async () =>
          await fsp
            .access(pidFile)
            .then(() => true)
            .catch(() => false),
        5_000,
      );
      childPid = Number(await fsp.readFile(pidFile, "utf8"));
      assert.ok(Number.isFinite(childPid) && childPid > 1);
      owner.kill("SIGKILL");
      await waitFor(async () => {
        try {
          process.kill(childPid, 0);
          return false;
        } catch {
          return true;
        }
      }, 5_000);
    } finally {
      owner.kill("SIGKILL");
      if (childPid > 1) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {}
      }
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  },
);
