#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("update-pnpm-hash nix helpers use managed command execution with bounded timeout", async () => {
  const txt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/nix.ts"),
    "utf8",
  );
  if (!txt.includes("runManagedCommand({")) {
    throw new Error("update-pnpm-hash/nix.ts must execute nix commands via managed process helper");
  }
  if (!txt.includes("timeoutMs: timeoutSec * 1000")) {
    throw new Error("update-pnpm-hash/nix.ts must bound nix build execution time");
  }
  if (!txt.includes("descendants terminated")) {
    throw new Error("update-pnpm-hash/nix.ts must report descendant teardown on timeout");
  }
  if (!txt.includes("!res.interrupted && !res.timedOut")) {
    throw new Error("interrupted reconciliation must not retry after owned child shutdown");
  }
});
