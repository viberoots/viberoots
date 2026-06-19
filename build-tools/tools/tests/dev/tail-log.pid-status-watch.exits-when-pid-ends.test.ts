#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildToolPath } from "../../dev/dev-build/paths";

test("tail-log: explicit PID --status -w exits after the PID ends (no switching)", async () => {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), "tail-log-pid-watch-exit-"));
  const logsDir = path.join(ws, "buck-out", "tmp", "verify-logs");
  const byPidDir = path.join(logsDir, "by-pid");
  await fsp.mkdir(byPidDir, { recursive: true });

  const logFile = path.join(logsDir, "verify-pid.log");
  await fsp.writeFile(logFile, "[verify] buck2 test begin iso=v-1 start_s=1\n", "utf8");
  const logReal = await fsp.realpath(logFile);

  const sleeper = spawn("sleep", ["60"], { stdio: "ignore" });
  assert.ok(typeof sleeper.pid === "number" && sleeper.pid > 0);
  const pid = sleeper.pid;

  await fsp.symlink(logFile, path.join(byPidDir, `${pid}.log`));

  const tailLog = spawn(
    buildToolPath(process.cwd(), "tools/bin/tail-log"),
    ["--status", "-w", "0.05", "--json", String(pid)],
    {
      cwd: process.cwd(),
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

  let buf = "";
  const seen: any[] = [];
  let sawPidOnce = false;
  let sawPidResolve: (() => void) | null = null;
  const sawPid = new Promise<void>((resolve) => {
    sawPidResolve = resolve;
  });
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
        const obj = JSON.parse(line);
        seen.push(obj);
        if (!sawPidOnce && obj && obj.pid === pid) {
          sawPidOnce = true;
          sawPidResolve?.();
          sawPidResolve = null;
        }
      } catch {
        // ignore
      }
    }
  });

  const waitForExit = async (): Promise<number> => {
    const t = setTimeout(() => {
      tailLog.kill("SIGKILL");
    }, 20_000);
    try {
      const [code] = (await once(tailLog, "exit")) as [number | null];
      return code ?? -1;
    } finally {
      clearTimeout(t);
    }
  };

  const sawTimeout = setTimeout(() => {
    tailLog.kill("SIGKILL");
  }, 30_000);
  try {
    await sawPid;
  } finally {
    clearTimeout(sawTimeout);
  }

  sleeper.kill("SIGTERM");
  await once(sleeper, "exit");

  const exitCode = await waitForExit();

  assert.equal(exitCode, 0);
  assert.ok(seen.length >= 1);
  assert.equal(seen.at(-1).pid, pid);
  assert.equal(seen.at(-1).log, logReal);
  assert.equal(seen.at(-1).stopped, true);
  assert.equal(seen.at(-1).stop_reason, "process-exited");
});
