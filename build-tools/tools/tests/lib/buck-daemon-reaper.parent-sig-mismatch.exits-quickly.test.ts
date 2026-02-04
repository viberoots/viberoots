#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

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

test("buck-daemon-reaper: does not wait when parent-sig mismatches (pid reuse guard)", async () => {
  const stateFile = path.join(os.tmpdir(), `bucknix-reaper-state-${process.pid}-${Date.now()}.txt`);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "bucknix-reaper-test-"));
  try {
    await fsp.writeFile(stateFile, `${tmp}\n`, "utf8");

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
        String(process.pid),
        "--parent-sig",
        "definitely-not-a-real-ps-start-time",
        "--state-file",
        stateFile,
        "--poll-ms",
        "250",
      ],
      { stdio: "ignore" },
    );

    // Under full-suite load, process startup can be slower; this should still exit well before
    // any "wait for parent" behavior would complete (the parent is this test process).
    const res = await waitForExit(reaper, 15_000);
    // Any exit code is fine; the key invariant is "it exits quickly without waiting for our pid".
    assert.ok(res);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(stateFile, { force: true }).catch(() => {});
  }
});
