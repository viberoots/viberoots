import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  diskUsageCommand,
  NATIVE_PNPM_COMMAND_TIMEOUT_MS,
  parseDfUsedKib,
  parseNonnegativeKib,
  runGuardedCommand,
} from "./pnpm-fixed-store-native-run";

test("native reconciliation uses the production cold command budget", () => {
  assert.equal(NATIVE_PNPM_COMMAND_TIMEOUT_MS, 600_000);
});

test("disk guard measurements fail closed on malformed size output", () => {
  assert.equal(parseNonnegativeKib("2048", "du"), 2048);
  assert.equal(
    parseDfUsedKib(
      "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk 9 7 2 78% /nix",
    ),
    7,
  );
  assert.throws(() => parseNonnegativeKib("not-a-size", "du"), /nonnegative KiB value/);
  assert.throws(() => parseNonnegativeKib(undefined, "df"), /nonnegative KiB value/);
  assert.throws(() => parseDfUsedKib("not df output"), /nonnegative KiB value/);
});

test("disk guard samples the requested APFS volume with Apple's df", () => {
  assert.deepEqual(diskUsageCommand("/nix", "darwin"), {
    command: "/bin/df",
    args: ["-k", "/nix"],
  });
  assert.deepEqual(diskUsageCommand("/nix", "linux"), {
    command: "df",
    args: ["-k", "/nix"],
  });
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

test("guarded command preserves an in-flight sample failure observed during child close", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-guarded-close-race-"));
  let samples = 0;
  try {
    await assert.rejects(
      runGuardedCommand("bash", ["--noprofile", "--norc", "-c", "sleep 0.02"], {
        cwd: root,
        fixtureRoot: root,
        maxKib: 1024,
        measureUsage: async () => {
          samples++;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { diskDeltaKib: 0, fixtureKib: 2048 };
        },
        sampleIntervalMs: 1,
      }),
      /native reconcile exceeded 1024KiB guard/,
    );
    assert.equal(samples, 1);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
