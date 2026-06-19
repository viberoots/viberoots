#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash emits heartbeat logs for long-running build phases", async () => {
  const heartbeatFile = "viberoots/build-tools/tools/dev/update-pnpm-hash/heartbeat.ts";
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
  const mainFile = "viberoots/build-tools/tools/dev/update-pnpm-hash.ts";
  const mainTxt = await fsp.readFile(mainFile, "utf8");
  if (!mainTxt.includes("withHeartbeat(")) {
    throw new Error("update-pnpm-hash.ts must wrap long-running build calls with heartbeat");
  }
});
