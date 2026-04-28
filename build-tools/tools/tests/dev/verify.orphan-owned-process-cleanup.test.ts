#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { cleanupOrphanBuckDaemons } from "../../dev/verify/buck-orphan-cleanup";
import { parseVerifyOwnedState } from "../../dev/verify/owned-process-state";
import { cleanupCurrentVerifyEnvProcesses } from "../../dev/verify/verify-owned-orphan-cleanup";
import { resolveToolPathSync } from "../../lib/tool-paths";

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidGone(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pidAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`pid ${pid} still alive after ${timeoutMs}ms`);
}

async function waitForVisibleOrphanInPs(
  pid: number,
  logFile: string,
  stateFile: string,
  timeoutMs: number,
  opts: { requireRegistered: boolean } = { requireRegistered: true },
): Promise<void> {
  const psPath = resolveToolPathSync("ps");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stdout = await new Promise<string>((resolve) => {
      const child = spawn(psPath, ["eww", "-p", String(pid), "-o", "pid=,ppid=,pgid=,command="], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let buf = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buf += chunk;
      });
      child.on("error", () => resolve(""));
      child.on("close", () => resolve(String(buf || "")));
    });
    const line = String(stdout || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean);
    if (line) {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (match && Number(match[2]) <= 1) {
        if (!opts.requireRegistered) return;
        const stateText = await fsp.readFile(stateFile, "utf8").catch(() => "");
        const registered = parseVerifyOwnedState(stateText).processes.some(
          (entry) => entry.pid === pid && entry.logFile === logFile,
        );
        if (registered) return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`pid ${pid} did not become a visible orphan within ${timeoutMs}ms`);
}

test("verify orphan cleanup: kills orphaned verify-owned node processes only", async () => {
  const repoRoot = process.cwd();
  const stateFile = path.join(
    os.tmpdir(),
    `bucknix-buck-reaper-v-999999-${process.pid}-${Date.now()}.txt`,
  );
  const logFile = path.join(
    repoRoot,
    "buck-out",
    "tmp",
    "verify-logs",
    `orphan-owned-${process.pid}.log`,
  );
  await fsp.writeFile(stateFile, "", "utf8");
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  await fsp.writeFile(logFile, "", "utf8");

  const launcher = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['--experimental-strip-types', '--import', process.argv[1], '-e', 'setInterval(() => {}, 1000)'], {",
    "  detached: true,",
    "  stdio: 'ignore',",
    "  env: {",
    "    ...process.env,",
    "    BNX_VERIFY_PROCESS_STATE_FILE: process.argv[2],",
    "    BNX_BUCK_REAPER_STATE_FILE: process.argv[2],",
    "    BNX_VERIFY_LOG_FILE: process.argv[3],",
    "    BNX_VERIFY_REGISTER_PROCESS: '1',",
    "    BUCK_TEST_TARGET: 'root//:verify_orphan_owned_process_cleanup'",
    "  }",
    "});",
    "console.log(String(child.pid || ''));",
    "child.unref();",
  ].join("\n");
  const zxInit = path.join(repoRoot, "build-tools", "tools", "dev", "zx-init.mjs");
  const parent = spawn(process.execPath, ["-e", launcher, zxInit, stateFile, logFile], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let out = "";
  parent.stdout.setEncoding("utf8");
  parent.stdout.on("data", (chunk) => {
    out += chunk;
  });
  const exit = await new Promise<number>((resolve, reject) => {
    parent.on("error", reject);
    parent.on("close", (code) => resolve(typeof code === "number" ? code : 1));
  });
  assert.equal(exit, 0, `launcher exited with ${exit}`);
  const orphanPid = Number(String(out || "").trim());
  assert.ok(
    Number.isFinite(orphanPid) && orphanPid > 1,
    `expected orphan pid in stdout, got '${out}'`,
  );
  await waitForVisibleOrphanInPs(orphanPid, logFile, stateFile, 10_000);

  const prevGrace = process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS;
  process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS = "0";
  try {
    const result = await cleanupOrphanBuckDaemons({ maxKills: 20 });
    assert.ok(
      result.killed >= 1,
      `expected orphan cleanup to kill at least one process, got ${JSON.stringify(result)}`,
    );
    await waitForPidGone(orphanPid, 10_000);
  } finally {
    if (prevGrace === undefined) delete process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS;
    else process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS = prevGrace;
    try {
      process.kill(orphanPid, "SIGKILL");
    } catch {}
    await fsp.rm(stateFile, { force: true }).catch(() => {});
    await fsp.rm(logFile, { force: true }).catch(() => {});
  }
});

test("verify orphan cleanup: kills orphaned verify-env test processes without registration", async () => {
  const repoRoot = process.cwd();
  const stateFile = path.join(
    os.tmpdir(),
    `bucknix-buck-reaper-v-999998-${process.pid}-${Date.now()}.txt`,
  );
  const logFile = path.join(
    repoRoot,
    "buck-out",
    "tmp",
    "verify-logs",
    `orphan-env-${process.pid}.log`,
  );
  await fsp.writeFile(stateFile, "", "utf8");
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  await fsp.writeFile(logFile, "", "utf8");

  const launcher = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {",
    "  detached: true,",
    "  stdio: 'ignore',",
    "  env: {",
    "    ...process.env,",
    "    BNX_VERIFY_PROCESS_STATE_FILE: process.argv[1],",
    "    BNX_BUCK_REAPER_STATE_FILE: process.argv[1],",
    "    BNX_VERIFY_LOG_FILE: process.argv[2],",
    "    BUCK_TEST_TARGET: 'root//:verify_orphan_env_process_cleanup'",
    "  }",
    "});",
    "console.log(String(child.pid || ''));",
    "child.unref();",
  ].join("\n");
  const parent = spawn(process.execPath, ["-e", launcher, stateFile, logFile], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let out = "";
  parent.stdout.setEncoding("utf8");
  parent.stdout.on("data", (chunk) => {
    out += chunk;
  });
  const exit = await new Promise<number>((resolve, reject) => {
    parent.on("error", reject);
    parent.on("close", (code) => resolve(typeof code === "number" ? code : 1));
  });
  assert.equal(exit, 0, `launcher exited with ${exit}`);
  const orphanPid = Number(String(out || "").trim());
  assert.ok(
    Number.isFinite(orphanPid) && orphanPid > 1,
    `expected orphan pid in stdout, got '${out}'`,
  );
  await waitForVisibleOrphanInPs(orphanPid, logFile, stateFile, 10_000, {
    requireRegistered: false,
  });

  const prevGrace = process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS;
  process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS = "0";
  try {
    const result = await cleanupOrphanBuckDaemons({ maxKills: 20 });
    assert.ok(
      result.killed >= 1,
      `expected orphan cleanup to kill at least one process, got ${JSON.stringify(result)}`,
    );
    await waitForPidGone(orphanPid, 10_000);
  } finally {
    if (prevGrace === undefined) delete process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS;
    else process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS = prevGrace;
    try {
      process.kill(orphanPid, "SIGKILL");
    } catch {}
    await fsp.rm(stateFile, { force: true }).catch(() => {});
    await fsp.rm(logFile, { force: true }).catch(() => {});
  }
});

test("verify env cleanup: kills current-run verify test process groups without registration", async () => {
  const repoRoot = process.cwd();
  const stateFile = path.join(
    os.tmpdir(),
    `bucknix-buck-reaper-v-${process.pid}-${Date.now()}.txt`,
  );
  const logFile = path.join(
    repoRoot,
    "buck-out",
    "tmp",
    "verify-logs",
    `current-env-${process.pid}.log`,
  );
  await fsp.writeFile(stateFile, "", "utf8");
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  await fsp.writeFile(logFile, "", "utf8");

  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      BNX_VERIFY_PROCESS_STATE_FILE: stateFile,
      BNX_BUCK_REAPER_STATE_FILE: stateFile,
      BNX_VERIFY_LOG_FILE: logFile,
      BUCK_TEST_TARGET: "root//:verify_current_env_process_cleanup",
    },
  });
  assert.ok(child.pid && child.pid > 1);
  child.unref();

  try {
    const result = await cleanupCurrentVerifyEnvProcesses({
      stateFile,
      logFile,
      maxKills: 20,
    });
    assert.equal(result.killed, 1, `expected one kill, got ${JSON.stringify(result)}`);
    await waitForPidGone(child.pid, 10_000);
  } finally {
    try {
      child.kill("SIGKILL");
    } catch {}
    await fsp.rm(stateFile, { force: true }).catch(() => {});
    await fsp.rm(logFile, { force: true }).catch(() => {});
  }
});
