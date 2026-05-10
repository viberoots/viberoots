#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("managed-command starts parent-lifecycle watchdog for spawned process group", async () => {
  const txt = await fsp.readFile("build-tools/tools/lib/managed-command.ts", "utf8");
  const watchdogTxt = await fsp.readFile(
    "build-tools/tools/lib/managed-command-watchdog.ts",
    "utf8",
  );
  if (!txt.includes("startParentWatchdog")) {
    throw new Error("managed-command.ts must define parent-lifecycle watchdog helper");
  }
  if (
    !txt.includes("resolveWatchdogShell") ||
    !watchdogTxt.includes('resolveToolPathSync("bash"') ||
    !txt.includes("detached: true")
  ) {
    throw new Error("managed-command.ts watchdog must run as a detached resolved bash helper");
  }
  if (
    (txt.includes("env.SHELL") || watchdogTxt.includes("env.SHELL")) &&
    txt.includes("--noprofile")
  ) {
    throw new Error("managed-command.ts watchdog must not pass bash-only flags to env.SHELL");
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
    !watchdogTxt.includes("delete scrubbed.BUCK_TEST_TARGET") ||
    !watchdogTxt.includes("delete scrubbed.BNX_VERIFY_LOG_FILE") ||
    !watchdogTxt.includes("delete scrubbed.BNX_VERIFY_PROCESS_STATE_FILE") ||
    !watchdogTxt.includes("delete scrubbed.BNX_BUCK_REAPER_STATE_FILE")
  ) {
    throw new Error("managed-command.ts watchdog must not inherit verify ownership env");
  }
});
