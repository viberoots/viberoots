#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runHousekeeping } from "../../dev/dev-build/housekeeping";

async function withGcFixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-build-gc-quiescence-"));
  const previous = {
    gc: process.env.VBR_GC_MODE,
    housekeeping: process.env.VBR_HOUSEKEEPING,
    optimise: process.env.VBR_OPTIMISE_MODE,
    verifyLock: process.env.VBR_VERIFY_LOCK_DIR,
  };
  try {
    process.env.VBR_GC_MODE = "auto";
    process.env.VBR_HOUSEKEEPING = "1";
    process.env.VBR_OPTIMISE_MODE = "off";
    delete process.env.VBR_VERIFY_LOCK_DIR;
    await run(root);
  } finally {
    for (const [key, value] of [
      ["VBR_GC_MODE", previous.gc],
      ["VBR_HOUSEKEEPING", previous.housekeeping],
      ["VBR_OPTIMISE_MODE", previous.optimise],
      ["VBR_VERIFY_LOCK_DIR", previous.verifyLock],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fsp.rm(root, { recursive: true, force: true });
  }
}

const lowDisk = async () => ({ freeBytes: 5 * 1024 * 1024 * 1024, freePct: 5 });

test("dev-build GC fails closed after a quiescent client timeout below the hard floor", async () => {
  await withGcFixture(async (root) => {
    const events: string[] = [];
    await assert.rejects(
      runHousekeeping({
        cleanTempOuts: async () => true,
        diskStats: lowDisk,
        isCI: false,
        root,
        runNixGc: async () => {
          events.push("client-timeout");
          return 124;
        },
        waitForNixGcQuiescence: async () => {
          events.push("daemon-quiescent");
          return [];
        },
      }),
      /client exited 124 after the store became quiescent with 5\.0GiB free/,
    );
    assert.deepEqual(events, ["client-timeout", "daemon-quiescent"]);
    await assert.rejects(fsp.access(path.join(root, "buck-out/.housekeeping/.gc-stamp")));
  });
});

test("dev-build GC publishes completion only after daemon quiescence", async () => {
  await withGcFixture(async (root) => {
    const events: string[] = [];
    await runHousekeeping({
      cleanTempOuts: async () => true,
      diskStats: lowDisk,
      isCI: false,
      root,
      runNixGc: async () => {
        events.push("client-complete");
        return 0;
      },
      waitForNixGcQuiescence: async () => {
        events.push("daemon-quiescent");
        return [];
      },
    });
    assert.deepEqual(events, ["client-complete", "daemon-quiescent"]);
    await fsp.access(path.join(root, "buck-out/.housekeeping/.gc-stamp"));
  });
});

test("dev-build GC accepts a timed-out client after quiescence above the hard floor", async () => {
  await withGcFixture(async (root) => {
    let statsCalls = 0;
    await runHousekeeping({
      cleanTempOuts: async () => true,
      diskStats: async () => ({
        freeBytes: (5 + (statsCalls++ === 0 ? 0 : 4)) * 1024 * 1024 * 1024,
        freePct: 5,
      }),
      isCI: false,
      root,
      runNixGc: async () => 124,
      waitForNixGcQuiescence: async () => [],
    });
    await fsp.access(path.join(root, "buck-out/.housekeeping/.gc-stamp"));
  });
});

test("dev-build GC accepts no observed gain after quiescence above the hard floor", async () => {
  await withGcFixture(async (root) => {
    await runHousekeeping({
      cleanTempOuts: async () => true,
      diskStats: async () => ({ freeBytes: 9 * 1024 * 1024 * 1024, freePct: 5 }),
      isCI: false,
      root,
      runNixGc: async () => 124,
      waitForNixGcQuiescence: async () => [],
    });
    await fsp.access(path.join(root, "buck-out/.housekeeping/.gc-stamp"));
  });
});

test("dev-build GC rejects a timed-out client while a daemon remains active", async () => {
  await withGcFixture(async (root) => {
    let statsCalls = 0;
    await assert.rejects(
      runHousekeeping({
        cleanTempOuts: async () => true,
        diskStats: async () => ({
          freeBytes: (5 + (statsCalls++ === 0 ? 0 : 1)) * 1024 * 1024 * 1024,
          freePct: 5,
        }),
        isCI: false,
        root,
        runNixGc: async () => 124,
        waitForNixGcQuiescence: async () => [4242],
      }),
      /4242/,
    );
    await assert.rejects(fsp.access(path.join(root, "buck-out/.housekeeping/.gc-stamp")));
  });
});
