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

test("activeNixGcProcesses ignores wrapper commands that mention a gc command", async () => {
  const processes = await activeNixGcProcesses({
    runPs: async () => ({
      exitCode: 0,
      stdout: [
        " 101 /bin/zsh -c nix-store --gc --print-roots > evidence.txt",
        " 102 /bin/bash -lc 'nix store gc'",
        " 103 node verify --selector='nix-store --gc'",
        " 202 /nix/store/example/bin/nix-store --gc",
        " 203 /usr/bin/env NIX_REMOTE=daemon /nix/store/example/bin/nix store gc",
        " 204 /usr/bin/sudo -n /nix/store/example/bin/nix-store --gc",
      ].join("\n"),
    }),
  });

  assert.deepEqual(processes, [
    { pid: 202, command: "/nix/store/example/bin/nix-store --gc" },
    {
      pid: 203,
      command: "/usr/bin/env NIX_REMOTE=daemon /nix/store/example/bin/nix store gc",
    },
    { pid: 204, command: "/usr/bin/sudo -n /nix/store/example/bin/nix-store --gc" },
  ]);
});

test("recordNixGcPreflight records active gc and continues without waiting", async () => {
  const lines: string[] = [];
  const stderr: string[] = [];

  await recordNixGcPreflight(null, {
    activeNixGcProcesses: async () => [{ pid: 101, command: "nix store gc --max 1G" }],
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
  assert.match(stderr.join(""), /recording GC evidence and continuing/);
});
