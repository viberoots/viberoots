#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("managed-command starts parent-lifecycle watchdog for spawned process group", async () => {
  const txt = await fsp.readFile("build-tools/tools/lib/managed-command.ts", "utf8");
  if (!txt.includes("startParentWatchdog")) {
    throw new Error("managed-command.ts must define parent-lifecycle watchdog helper");
  }
  if (!txt.includes('env.BASH || env.SHELL || "bash"') || !txt.includes("detached: true")) {
    throw new Error("managed-command.ts watchdog must run as a detached env-resolved shell helper");
  }
  if (!txt.includes('wd.once("error"')) {
    throw new Error("managed-command.ts watchdog must handle shell spawn failures");
  }
  if (!txt.includes("kill -TERM -") || !txt.includes("kill -KILL -")) {
    throw new Error(
      "managed-command.ts watchdog must terminate child process group on parent death",
    );
  }
  if (
    !txt.includes("watchdogEnvFor") ||
    !txt.includes("delete scrubbed.BUCK_TEST_TARGET") ||
    !txt.includes("delete scrubbed.BNX_VERIFY_LOG_FILE") ||
    !txt.includes("delete scrubbed.BNX_VERIFY_PROCESS_STATE_FILE") ||
    !txt.includes("delete scrubbed.BNX_BUCK_REAPER_STATE_FILE")
  ) {
    throw new Error("managed-command.ts watchdog must not inherit verify ownership env");
  }
});
