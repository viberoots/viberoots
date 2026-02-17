#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("link-node non-default importer build uses heartbeat and timeout", async () => {
  const mainFile = "build-tools/tools/dev/install/link-node.ts";
  const helperFile = "build-tools/tools/dev/install/link-node-helpers.ts";
  const main = await fsp.readFile(mainFile, "utf8");
  const helper = await fsp.readFile(helperFile, "utf8");
  if (!main.includes("withHeartbeat(")) {
    throw new Error("link-node.ts must wrap non-default importer nix build with heartbeat");
  }
  if (!main.includes("step=build attr=node-modules.")) {
    throw new Error("link-node.ts must log non-default importer build progress step");
  }
  if (!main.includes("timeoutMs: nixBuildTimeoutMs")) {
    throw new Error("link-node.ts must bound non-default importer nix build duration");
  }
  if (!main.includes("runManagedCommand({")) {
    throw new Error("link-node.ts must run nix build via managed command executor");
  }
  if (!helper.includes("progress phase=") || !helper.includes("waiting phase=")) {
    throw new Error("link-node heartbeat must include progress and waiting states");
  }
  if (
    !helper.includes("state=") ||
    !helper.includes("nix_gc=") ||
    !helper.includes("likely_waiting=true")
  ) {
    throw new Error(
      "link-node heartbeat must include child state, GC signal, and likely-waiting hint",
    );
  }
});
