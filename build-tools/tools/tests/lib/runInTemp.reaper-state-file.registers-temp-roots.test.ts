#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("runInTemp: when BNX_BUCK_REAPER_STATE_FILE is set, temp repo roots are registered", async () => {
  const prev = process.env.BNX_BUCK_REAPER_STATE_FILE;
  const stateFile = path.join(
    os.tmpdir(),
    `bucknix-test-reaper-state-${process.pid}-${Date.now()}.txt`,
  );

  try {
    process.env.BNX_BUCK_REAPER_STATE_FILE = stateFile;
    await fsp.writeFile(stateFile, "", "utf8");

    const roots: string[] = [];
    await runInTemp("reaper-register-1", async (tmp) => roots.push(tmp));
    await runInTemp("reaper-register-2", async (tmp) => roots.push(tmp));

    const txt = await fsp.readFile(stateFile, "utf8");
    const lines = txt
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      throw new Error(`expected state file to have at least 2 entries, got ${lines.length}`);
    }
    for (const r of roots) {
      if (!lines.includes(r)) {
        throw new Error(`expected state file to include temp repo root: ${r}`);
      }
    }
  } finally {
    if (prev === undefined) delete process.env.BNX_BUCK_REAPER_STATE_FILE;
    else process.env.BNX_BUCK_REAPER_STATE_FILE = prev;
    await fsp.rm(stateFile, { force: true }).catch(() => {});
  }
});
