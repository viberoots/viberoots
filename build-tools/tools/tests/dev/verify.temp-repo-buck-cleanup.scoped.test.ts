#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cleanupRegisteredTempRepos } from "../../dev/verify/buck-orphan-cleanup.ts";
function psBuck2dLines(base: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn("/bin/ps", ["-A", "-o", "pid=,command="], {
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
      resolve(lines.filter((l) => l.includes(`buck2d[${base}]`)));
    });
  });
}

async function waitForBuck2d(base: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lines = await psBuck2dLines(base);
    if (lines.length > 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  const lines = await psBuck2dLines(base);
  throw new Error(`expected buck2d[${base}] to appear, got:\n${lines.join("\n")}`);
}

async function waitForNoBuck2d(base: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lines = await psBuck2dLines(base);
    if (lines.length === 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  const lines = await psBuck2dLines(base);
  throw new Error(`expected buck2d[${base}] to disappear, got:\n${lines.join("\n")}`);
}

test(
  "verify cleanup: scoped temp repo buck cleanup does not kill other temp repos",
  { timeout: 240_000 },
  async () => {
    const nodeBin = process.execPath;
    const childScript = new URL(
      "../lib/buck-daemon-cleanup.non-disruptive.child.ts",
      import.meta.url,
    ).pathname;
    const zxInit = new URL("../../dev/zx-init.mjs", import.meta.url).pathname;

    const spawnChild = () =>
      spawn(nodeBin, ["--experimental-strip-types", "--import", zxInit, childScript], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, BNX_BUCK_REAPER_STATE_FILE: "" },
      });

    const attachReady = (child: ReturnType<typeof spawnChild>) => {
      let tmp = "";
      let out = "";
      let ready = false;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d) => {
        out += d;
        const m = out.match(/TMP\s+(\S+)/);
        if (m && m[1]) tmp = String(m[1]).trim();
        if (out.includes("\nREADY\n") || out.trimEnd().endsWith("READY")) ready = true;
      });
      return { getTmp: () => tmp, getReady: () => ready, getOut: () => out };
    };

    const foreign = spawnChild();
    const foreignState = attachReady(foreign);
    const owned = spawnChild();
    const ownedState = attachReady(owned);

    const t0 = Date.now();
    while (
      (!foreignState.getTmp() || !foreignState.getReady() || !ownedState.getTmp()) &&
      Date.now() - t0 < 60_000
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const foreignTmp = foreignState.getTmp();
    const ownedTmp = ownedState.getTmp();
    assert.ok(foreignTmp, `expected foreign tmp path; got stdout:\n${foreignState.getOut()}`);
    assert.ok(ownedTmp, `expected owned tmp path; got stdout:\n${ownedState.getOut()}`);

    const foreignBase = path.basename(foreignTmp);
    const ownedBase = path.basename(ownedTmp);
    await waitForBuck2d(foreignBase, 30_000);
    await waitForBuck2d(ownedBase, 30_000);

    const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-cleanup-state-"));
    const stateFile = path.join(stateDir, "state.txt");
    await fsp.writeFile(stateFile, `${ownedTmp}\n`, "utf8");

    await cleanupRegisteredTempRepos({ stateFile, maxKills: 50 });
    await waitForNoBuck2d(ownedBase, 30_000);
    await waitForBuck2d(foreignBase, 10_000);

    try {
      foreign.kill("SIGKILL");
    } catch {}
    try {
      owned.kill("SIGKILL");
    } catch {}
    await fsp.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  },
);
