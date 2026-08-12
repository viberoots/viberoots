#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildToolPath } from "../../dev/dev-build/paths";
import { resolveLatest } from "../../dev/tail-log/resolve";

test("tail-log: latest --status -w switches with an inactive latest.log pointer", async () => {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), "tail-log-latest-switch-"));
  const logsDir = path.join(ws, "buck-out", "tmp", "verify-logs");
  await fsp.mkdir(logsDir, { recursive: true });

  const log1 = path.join(logsDir, "verify-1.log");
  await fsp.writeFile(log1, "[verify] buck2 test begin iso=v-1 start_s=1\n", "utf8");
  await fsp.symlink(log1, path.join(logsDir, "latest.log"));
  const log1Real = await fsp.realpath(log1);

  const tailLog = spawn(
    buildToolPath(process.cwd(), "tools/bin/tail-log"),
    ["--status", "-w", "0.05", "--json"],
    {
      cwd: ws,
      env: {
        ...process.env,
        WORKSPACE_ROOT: ws,
        NO_DEV_SHELL: "1",
        // In temp-workspace tests, WORKSPACE_ROOT points at the temp tree, but zx-init must come
        // from the real checkout so TypeScript tooling can run.
        ZX_INIT: buildToolPath(process.cwd(), "tools/dev/zx-init.mjs"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const tailLogExit = new Promise<number>((resolve) => {
    tailLog.once("exit", (code) => resolve(code ?? -1));
  });

  let buf = "";
  const seen: any[] = [];
  tailLog.stdout?.setEncoding("utf8");
  tailLog.stdout?.on("data", (chunk) => {
    buf += chunk;
    while (true) {
      const idx = buf.indexOf("\n");
      if (idx < 0) break;
      const line = buf.slice(0, idx).trimEnd();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        seen.push(JSON.parse(line));
      } catch {
        // ignore
      }
    }
  });

  const waitFor = async (pred: (o: any) => boolean, timeoutMs: number) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (seen.some(pred)) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.fail(`timed out; last=${JSON.stringify(seen.at(-1) || null)}`);
  };
  const waitTimeoutMs = 15000;

  try {
    await waitFor((o) => o && (o.pid ?? 0) === 0 && o.log === log1Real, waitTimeoutMs);

    const log2 = path.join(logsDir, "verify-2.log");
    await fsp.writeFile(log2, "[verify] buck2 test begin iso=v-2 start_s=1\n", "utf8");
    const log2Real = await fsp.realpath(log2);
    const nextLatest = path.join(logsDir, "latest.next.log");
    await fsp.symlink(log2, nextLatest);
    await fsp.rename(nextLatest, path.join(logsDir, "latest.log"));

    await waitFor((o) => o && (o.pid ?? 0) === 0 && o.log === log2Real, waitTimeoutMs);
  } finally {
    tailLog.kill("SIGTERM");
    // Avoid hangs if the process already exited before we attach an exit listener.
    await Promise.race([
      tailLogExit,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("tail-log did not exit")), 2000),
      ),
    ]).catch(() => {});
  }
});

test("tail-log: latest resolver switches live lock logs with injected liveness", async () => {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), "tail-log-lock-switch-"));
  const logsDir = path.join(ws, "buck-out", "tmp", "verify-logs");
  const lockDir = path.join(ws, "buck-out", "tmp", "verify-lock");
  await fsp.mkdir(logsDir, { recursive: true });
  await fsp.mkdir(lockDir, { recursive: true });

  const log1 = path.join(logsDir, "verify-1.log");
  const log2 = path.join(logsDir, "verify-2.log");
  await fsp.writeFile(log1, "[verify] buck2 test begin iso=v-1 start_s=1\n", "utf8");
  await fsp.writeFile(log2, "[verify] buck2 test begin iso=v-2 start_s=1\n", "utf8");
  const log1Real = await fsp.realpath(log1);
  const log2Real = await fsp.realpath(log2);
  const lockPid = 4242;
  const dependencies = {
    candidateRoots: async () => [ws],
    pidAlive: async (pid: number) => pid === lockPid,
  };

  await fsp.writeFile(path.join(lockDir, "pid"), String(lockPid), "utf8");
  await fsp.writeFile(path.join(lockDir, "log"), log1Real, "utf8");
  assert.deepEqual(await resolveLatest(dependencies), {
    pid: lockPid,
    logPath: log1Real,
    active: true,
  });

  await fsp.writeFile(path.join(lockDir, "log"), log2Real, "utf8");
  assert.deepEqual(await resolveLatest(dependencies), {
    pid: lockPid,
    logPath: log2Real,
    active: true,
  });
});

test("tail-log: latest status finds hidden workspace test logs", async () => {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), "tail-log-hidden-test-"));
  const logsDir = path.join(ws, ".viberoots", "workspace", "buck", "test-logs");
  await fsp.mkdir(logsDir, { recursive: true });

  const log = path.join(logsDir, "pr9-focused-i-b-v-visible-root-20260617-211044.log");
  await fsp.writeFile(
    log,
    [
      "[verify] buck2 test begin iso=v-1 start_s=1",
      "Tests finished: Pass 18. Fail 0. Fatal 0. Skip 0. Build failure 0",
      "[verify] buck2 test exit iso=v-1 status=0 end_s=2",
    ].join("\n"),
    "utf8",
  );
  const logReal = await fsp.realpath(log);

  const tailLog = spawn(
    buildToolPath(process.cwd(), "tools/bin/tail-log"),
    ["--status", "--json"],
    {
      cwd: ws,
      env: {
        ...process.env,
        WORKSPACE_ROOT: ws,
        NO_DEV_SHELL: "1",
        ZX_INIT: buildToolPath(process.cwd(), "tools/dev/zx-init.mjs"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let out = "";
  let err = "";
  tailLog.stdout?.setEncoding("utf8");
  tailLog.stderr?.setEncoding("utf8");
  tailLog.stdout?.on("data", (chunk) => (out += chunk));
  tailLog.stderr?.on("data", (chunk) => (err += chunk));

  const code = await new Promise<number>((resolve) => {
    tailLog.once("exit", (exitCode) => resolve(exitCode ?? -1));
  });

  assert.equal(code, 0, err);
  const status = JSON.parse(out.trim());
  assert.equal(status.log, logReal);
  assert.equal(status.pass, 18);
  assert.equal(status.done, true);
});
