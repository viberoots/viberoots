#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("update-pnpm-hash emits heartbeat logs for long-running build phases", async () => {
  const heartbeatFile = viberootsSourcePath(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/heartbeat.ts",
  );
  const heartbeatTxt = await fsp.readFile(heartbeatFile, "utf8");
  if (!heartbeatTxt.includes("phase=") || !heartbeatTxt.includes("status=progress")) {
    throw new Error("update-pnpm-hash heartbeat must include phase and last-event timing");
  }
  if (
    !heartbeatTxt.includes("status=waiting-for-output") ||
    !heartbeatTxt.includes("child_alive=")
  ) {
    throw new Error("update-pnpm-hash heartbeat must show waiting state and child liveness");
  }
  if (!heartbeatTxt.includes("no_output_window_exceeded=true")) {
    throw new Error("update-pnpm-hash heartbeat must surface no-output stall windows");
  }
  for (const relativePath of [
    "viberoots/build-tools/tools/dev/update-pnpm-hash/build-flake.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-command.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/fixed-store-reconcile.ts",
  ]) {
    const source = await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
    if (!source.includes("withHeartbeat(")) {
      throw new Error(`${relativePath} must wrap its long-running command with heartbeat`);
    }
  }
});
