#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveToolPathSync } from "../../lib/tool-paths.ts";

function startSignatureForPid(pid: number, timeoutMs: number) {
  const psPath = resolveToolPathSync("ps");
  return new Promise<string>((resolve) => {
    const child = spawn(psPath, ["-p", String(pid), "-o", "lstart="], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (buf += d));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(String(buf || "").trim()));
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

test("buck-daemon-reaper: exits promptly after parent exits", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "bucknix-reaper-test-"));
  try {
    const parent = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    assert(parent.pid && parent.pid > 1);
    const parentSig = await startSignatureForPid(parent.pid, 1000);
    assert(parentSig, "expected non-empty parent lstart signature");

    const repoRoot = process.cwd();
    const reaperPath = path.join(
      repoRoot,
      "build-tools",
      "tools",
      "tests",
      "lib",
      "buck-daemon-reaper.ts",
    );
    const reaper = spawn(
      "zx-wrapper",
      [
        reaperPath,
        "--parent",
        String(parent.pid),
        "--parent-sig",
        parentSig,
        "--tmp",
        tmp,
        "--poll-ms",
        "250",
      ],
      { stdio: "ignore" },
    );

    try {
      parent.kill("SIGTERM");
    } catch {}
    await waitForExit(parent, 5_000);
    await waitForExit(reaper, 10_000);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
