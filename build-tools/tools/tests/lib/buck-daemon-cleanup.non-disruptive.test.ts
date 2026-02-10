#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

function psForkserversForToken(token: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn("/bin/ps", ["-A", "-o", "pid=,ppid=,command="], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (buf += d));
    child.on("error", () => resolve([]));
    child.on("close", () => {
      const lines = String(buf || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      resolve(
        lines.filter(
          (l) => l.includes("(buck2-forkserver)") && l.includes("--state-dir") && l.includes(token),
        ),
      );
    });
  });
}

async function waitForPresent(token: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lines = await psForkserversForToken(token);
    if (lines.length > 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`expected buck2-forkserver to appear for token=${token}`);
}

test("buck cleanup: does not kill buck2 daemons belonging to other running temp repos", async () => {
  // Start a long-running child temp repo that keeps a buck2 daemon alive.
  const nodeBin = process.execPath;
  const child = spawn(
    nodeBin,
    [
      "--experimental-strip-types",
      "--import",
      new URL("../../dev/zx-init.mjs", import.meta.url).pathname,
      new URL("./buck-daemon-cleanup.non-disruptive.child.ts", import.meta.url).pathname,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BNX_BUCK_REAPER_STATE_FILE: "" },
    },
  );

  let tmp = "";
  let stdout = "";
  let stderr = "";
  let ready = false;
  let exitCode: number | null = null;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    stdout += d;
    const m = stdout.match(/TMP\s+(\S+)/);
    if (m && m[1]) tmp = String(m[1]).trim();
    if (stdout.includes("\nREADY\n") || stdout.trimEnd().endsWith("READY")) ready = true;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  child.on("close", (code) => {
    exitCode = code;
  });

  const t0 = Date.now();
  while ((!tmp || !ready) && Date.now() - t0 < 120_000) {
    if (exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(tmp, `expected child tmp path; got stdout:\n${stdout}\nstderr:\n${stderr}`);
  assert.ok(ready, `expected child READY; got stdout:\n${stdout}\nstderr:\n${stderr}`);

  const token = path.basename(tmp);
  await waitForPresent(token, 10_000);

  // Run an unrelated temp-repo test. Its cleanup must not kill the child's forkserver,
  // because the child's repo still exists and is not under the other temp root.
  await runInTemp("buck-cleanup-nondisruptive-other", async (_tmp2, $) => {
    await $`buck2 build //:flake.lock`;
  });

  // Signal the child to run another buck2 build while it is still running.
  await fsp.writeFile(path.join(tmp, "go.signal"), "go\n", "utf8");

  const t1 = Date.now();
  while (!stdout.includes("PING_OK") && Date.now() - t1 < 60_000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(
    stdout.includes("PING_OK"),
    `expected child to complete second build; stdout:\n${stdout}`,
  );

  // Clean up the child.
  try {
    child.kill("SIGKILL");
  } catch {}
});
