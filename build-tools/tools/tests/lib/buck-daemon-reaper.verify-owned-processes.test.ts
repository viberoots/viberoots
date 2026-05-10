#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveToolPathSync } from "../../lib/tool-paths";

function startSignatureForPid(pid: number, timeoutMs: number) {
  const psPath = resolveToolPathSync("ps");
  return new Promise<string>((resolve) => {
    let child;
    try {
      child = spawn(psPath, ["-p", String(pid), "-o", "lstart="], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve(pidAlive(pid) ? `pid:${pid}` : "");
      return;
    }
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (buf += d));
    child.on("error", () => resolve(pidAlive(pid) ? `pid:${pid}` : ""));
    child.on("close", () =>
      resolve(String(buf || "").trim() || (pidAlive(pid) ? `pid:${pid}` : "")),
    );
    const t = setTimeout(
      () => {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve("");
      },
      Math.max(100, timeoutMs),
    );
    child.on("close", () => clearTimeout(t));
  });
}

function waitForExit(child: import("node:child_process").ChildProcess, timeoutMs: number) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      reject(new Error(`process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("exit", (code, signal) => {
      clearTimeout(t);
      resolve({ code, signal });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

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

async function waitForStateLine(
  stateFile: string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const txt = await fsp.readFile(stateFile, "utf8").catch(() => "");
    if (pattern.test(txt)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for state file line matching ${pattern}`);
}

test("buck-daemon-reaper: reaps registered verify-owned node processes after parent exit", async () => {
  const stateFile = path.join(
    os.tmpdir(),
    `viberoots-verify-owned-state-${process.pid}-${Date.now()}.txt`,
  );
  await fsp.writeFile(stateFile, "", "utf8");
  const parent = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  assert(parent.pid && parent.pid > 1);
  const parentSig = await startSignatureForPid(parent.pid, 1000);
  assert(parentSig, "expected non-empty parent lstart signature");

  const repoRoot = process.cwd();
  const zxInit = path.join(repoRoot, "build-tools", "tools", "dev", "zx-init.mjs");
  const helper = spawn(
    process.execPath,
    ["--experimental-strip-types", "--import", zxInit, "-e", "setInterval(() => {}, 1000)"],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        VBR_VERIFY_PROCESS_STATE_FILE: stateFile,
        VBR_VERIFY_LOG_FILE: path.join(
          repoRoot,
          "buck-out",
          "tmp",
          "verify-logs",
          "owned-process.log",
        ),
        VBR_VERIFY_REGISTER_PROCESS: "1",
        BUCK_TEST_TARGET: "root//:verify_owned_process_reaper",
      },
    },
  );
  assert(helper.pid && helper.pid > 1);
  helper.unref();

  const reaperPath = path.join(
    repoRoot,
    "build-tools",
    "tools",
    "tests",
    "lib",
    "buck-daemon-reaper.ts",
  );
  const reaper = spawn(
    process.execPath,
    [
      "--experimental-top-level-await",
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--import",
      zxInit,
      reaperPath,
      "--parent",
      String(parent.pid),
      "--parent-sig",
      parentSig,
      "--state-file",
      stateFile,
      "--poll-ms",
      "250",
    ],
    { stdio: "ignore" },
  );

  try {
    await waitForStateLine(stateFile, /process\t.*verify_owned_process_reaper/, 10_000);
    try {
      parent.kill("SIGTERM");
    } catch {}
    await waitForExit(parent, 5_000);
    await waitForExit(reaper, 10_000);
    await waitForPidGone(helper.pid, 10_000);
  } finally {
    try {
      parent.kill("SIGKILL");
    } catch {}
    try {
      helper.kill("SIGKILL");
    } catch {}
    try {
      reaper.kill("SIGKILL");
    } catch {}
    await fsp.rm(stateFile, { force: true }).catch(() => {});
  }
});
