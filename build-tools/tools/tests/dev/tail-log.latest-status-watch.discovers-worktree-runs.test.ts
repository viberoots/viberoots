#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildToolPath } from "../../dev/dev-build/paths";

test("tail-log: latest --status -w discovers verify runs in worktree subdirs", async () => {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), "tail-log-worktree-"));
  const wtName = "kind-haibt-test";
  const wtRoot = path.join(ws, ".claude", "worktrees", wtName);
  const wtLogsDir = path.join(wtRoot, "buck-out", "tmp", "verify-logs");
  await fsp.mkdir(wtLogsDir, { recursive: true });

  const wtLog = path.join(wtLogsDir, "verify-1.log");
  await fsp.writeFile(wtLog, "[verify] buck2 test begin iso=v-wt start_s=1\n", "utf8");
  await fsp.symlink(wtLog, path.join(wtLogsDir, "latest.log"));
  const wtLogReal = await fsp.realpath(wtLog);

  const tailLog = spawn(
    buildToolPath(process.cwd(), "tools/bin/tail-log"),
    ["--status", "-w", "0.05", "--json"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WORKSPACE_ROOT: ws,
        NO_DEV_SHELL: "1",
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

  try {
    await waitFor((o) => o && o.log === wtLogReal, 15000);
  } finally {
    tailLog.kill("SIGTERM");
    await Promise.race([
      tailLogExit,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("tail-log did not exit")), 2000),
      ),
    ]).catch(() => {});
  }
});
