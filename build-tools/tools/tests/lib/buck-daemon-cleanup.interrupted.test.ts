#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { buckProcessTableLines } from "../../lib/process-inspection";

async function psForkserversForToken(token: string): Promise<string[]> {
  const lines = await buckProcessTableLines(2000);
  return lines.filter(
    (line) =>
      line.includes("(buck2-forkserver)") && line.includes("--state-dir") && line.includes(token),
  );
}

async function waitForGone(token: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lines = await psForkserversForToken(token);
    if (lines.length === 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  const lines = await psForkserversForToken(token);
  throw new Error(`buck cleanup: forkservers still present after timeout:\n${lines.join("\n")}`);
}

test("buck cleanup: interrupted temp repo run is reaped (no orphan buck2 daemons)", async () => {
  // Spawn a child that creates a temp repo and starts a buck2 daemon, then blocks.
  // We SIGKILL the child to simulate an interruption; the detached buck-daemon-reaper
  // must reap any buck2d/forkserver processes rooted under that temp repo.
  const nodeBin = process.execPath;
  const child = spawn(
    nodeBin,
    [
      "--experimental-strip-types",
      "--import",
      new URL("../../dev/zx-init.mjs", import.meta.url).pathname,
      new URL("./buck-daemon-cleanup.interrupted.child.ts", import.meta.url).pathname,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      // IMPORTANT: verify runs set VBR_BUCK_REAPER_STATE_FILE to a shared per-run reaper.
      // For this test we need a *per-child* reaper (so we can assert cleanup happens promptly
      // after SIGKILL), so explicitly disable the shared reaper for the child.
      env: { ...process.env, VBR_BUCK_REAPER_STATE_FILE: "" },
    },
  );

  let tmp = "";
  let stdout = "";
  let stderr = "";
  let ready = false;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    stdout += d;
    const m = stdout.match(/KEEP_TMP\s+(\S+)/) || stdout.match(/TMP\s+(\S+)/);
    if (m && m[1]) tmp = String(m[1]).trim();
    if (stdout.includes("\nREADY\n") || stdout.trimEnd().endsWith("READY")) ready = true;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => {
    stderr += d;
  });

  try {
    // Wait for the child to report its temp path (and start buck2).
    const t0 = Date.now();
    while ((!tmp || !ready) && Date.now() - t0 < 120_000) {
      // If the child exits early, surface diagnostics immediately instead of hanging the test.
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(
      tmp,
      `expected child to print temp path; got stdout:\n${stdout}\n\nstderr:\n${stderr}`,
    );
    assert.ok(ready, `expected child to reach READY; got stdout:\n${stdout}\n\nstderr:\n${stderr}`);

    // Ensure a forkserver exists before killing (otherwise the test is vacuous).
    const token = path.basename(tmp);
    {
      const lines = await psForkserversForToken(token);
      assert.ok(lines.length > 0, "expected at least one buck2-forkserver before interruption");
    }

    try {
      child.kill("SIGKILL");
    } catch {}

    // The reaper polls at ~1s; allow a bit of time for cleanup.
    await waitForGone(token, 30_000);
  } finally {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
});
