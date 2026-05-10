#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
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
