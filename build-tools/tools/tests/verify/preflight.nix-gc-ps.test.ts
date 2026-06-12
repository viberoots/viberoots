#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { recordNixGcPreflight } from "../../dev/verify/nix-gc-preflight";
import { activeNixGcProcesses } from "../../dev/verify/preflight";

test("activeNixGcProcesses treats ps denial as no active gc evidence", async () => {
  const processes = await activeNixGcProcesses({
    runPs: async () => {
      throw new Error("Operation not permitted");
    },
  });

  assert.deepEqual(processes, []);
});

test("activeNixGcProcesses parses nix gc process rows", async () => {
  const processes = await activeNixGcProcesses({
    runPs: async () => ({
      exitCode: 0,
      stdout: [" 101 /nix/store/example/bin/nix store gc --max 1G", " 202 node verify"].join("\n"),
    }),
  });

  assert.deepEqual(processes, [
    { pid: 101, command: "/nix/store/example/bin/nix store gc --max 1G" },
  ]);
});

test("recordNixGcPreflight waits when nix gc is active and continues after it clears", async () => {
  const lines: string[] = [];
  const stderr: string[] = [];

  await recordNixGcPreflight(null, {
    activeNixGcProcesses: async () => [{ pid: 101, command: "nix store gc --max 1G" }],
    waitForNoActiveNixGc: async (opts) => {
      opts?.onWait?.([101], 2000, 180000);
      return [];
    },
    appendVerifyLogLine: async (_logFile, line) => {
      lines.push(line);
    },
    writeStderr: (text) => {
      stderr.push(text);
    },
  });

  assert.equal(process.env.VBR_VERIFY_NIX_GC_DETECTED, "1");
  assert.equal(process.env.VBR_VERIFY_NIX_GC_PRECHECK_OK, "1");
  assert.match(lines.join("\n"), /nix gc preflight warning: active_gc_processes=1/);
  assert.match(lines.join("\n"), /nix gc preflight: gc completed/);
  assert.match(stderr.join(""), /waiting for GC to finish before starting tests/);
  assert.match(stderr.join(""), /waiting elapsed=2s timeout=180s active=101/);
});

test("recordNixGcPreflight fails before verify when nix gc remains active", async () => {
  const lines: string[] = [];

  await assert.rejects(
    async () =>
      await recordNixGcPreflight(null, {
        activeNixGcProcesses: async () => [{ pid: 101, command: "nix store gc --max 1G" }],
        waitForNoActiveNixGc: async () => [101],
        appendVerifyLogLine: async (_logFile, line) => {
          lines.push(line);
        },
        writeStderr: () => {},
      }),
    /verify: blocked by active 'nix store gc' process\(es\): 101/,
  );

  assert.match(lines.join("\n"), /nix gc preflight error:/);
});
