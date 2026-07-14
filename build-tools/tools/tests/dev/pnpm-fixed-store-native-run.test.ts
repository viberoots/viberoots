import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseNonnegativeKib, runGuardedCommand } from "./pnpm-fixed-store-native-run";

test("disk guard measurements fail closed on malformed size output", () => {
  assert.equal(parseNonnegativeKib("2048", "du"), 2048);
  assert.throws(() => parseNonnegativeKib("not-a-size", "du"), /nonnegative KiB value/);
  assert.throws(() => parseNonnegativeKib(undefined, "df"), /nonnegative KiB value/);
});

test("guarded command preserves the guard error after child shutdown", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-guarded-command-"));
  const stoppedMarker = path.join(root, "stopped");
  try {
    await assert.rejects(
      runGuardedCommand(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-c",
          `trap 'sleep 0.1; printf stopped > "${stoppedMarker}"; exit 0' TERM; dd if=/dev/zero of=guard-input bs=2048k count=1 2>/dev/null; while true; do sleep 10; done`,
        ],
        {
          cwd: root,
          fixtureRoot: root,
          maxKib: 1024,
          sampleIntervalMs: 10,
        },
      ),
      /native reconcile exceeded 1024KiB guard/,
    );
    assert.equal(await fsp.readFile(stoppedMarker, "utf8"), "stopped");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
