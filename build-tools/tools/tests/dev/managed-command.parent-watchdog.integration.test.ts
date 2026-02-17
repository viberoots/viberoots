#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("managed-command starts parent-lifecycle watchdog for spawned process group", async () => {
  const txt = await fsp.readFile("build-tools/tools/lib/managed-command.ts", "utf8");
  if (!txt.includes("startParentWatchdog")) {
    throw new Error("managed-command.ts must define parent-lifecycle watchdog helper");
  }
  if (!txt.includes('"/bin/bash"') || !txt.includes("detached: true")) {
    throw new Error("managed-command.ts watchdog must run as detached bash helper");
  }
  if (!txt.includes("kill -TERM -") || !txt.includes("kill -KILL -")) {
    throw new Error(
      "managed-command.ts watchdog must terminate child process group on parent death",
    );
  }
});
