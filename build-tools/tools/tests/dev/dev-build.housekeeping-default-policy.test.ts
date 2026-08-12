#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runHousekeeping } from "../../dev/dev-build/housekeeping";

test("dev-build housekeeping defaults to warning-only under disk pressure", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-build-housekeeping-default-"));
  const previous = {
    gc: process.env.VBR_GC_MODE,
    housekeeping: process.env.VBR_HOUSEKEEPING,
    optimise: process.env.VBR_OPTIMISE_MODE,
    verbose: process.env.VBR_VERBOSE,
  };
  const messages: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const capture = (line?: unknown, ...args: unknown[]) => {
    messages.push([line, ...args].map(String).join(" "));
  };
  try {
    console.log = capture;
    console.warn = capture;
    delete process.env.VBR_GC_MODE;
    process.env.VBR_HOUSEKEEPING = "1";
    delete process.env.VBR_OPTIMISE_MODE;
    process.env.VBR_VERBOSE = "1";
    let gcCalls = 0;
    await runHousekeeping({
      cleanTempOuts: async () => true,
      diskStats: async () => ({ freeBytes: 5 * 1024 * 1024 * 1024, freePct: 5 }),
      isCI: false,
      root,
      runNixGc: async () => {
        gcCalls += 1;
        return 0;
      },
    });
    assert.equal(gcCalls, 0);
    await assert.rejects(fsp.access(path.join(root, "buck-out/.housekeeping/.gc-stamp")));
    await assert.rejects(fsp.access(path.join(root, "buck-out/.housekeeping/.optimize-stamp")));
    assert.ok(messages.includes("[housekeeping] optimise: skipped (off)"));
    assert.ok(
      messages.some(
        (line) =>
          line.includes("ordinary builds do not mutate the Nix store") &&
          line.includes("viberoots gc --dry-run") &&
          line.includes("viberoots gc --optimize"),
      ),
    );
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    for (const [key, value] of [
      ["VBR_GC_MODE", previous.gc],
      ["VBR_HOUSEKEEPING", previous.housekeeping],
      ["VBR_OPTIMISE_MODE", previous.optimise],
      ["VBR_VERBOSE", previous.verbose],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fsp.rm(root, { recursive: true, force: true });
  }
});
