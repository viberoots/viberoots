#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node-test build phase exposes env-gated phase timing diagnostics", async () => {
  const txt = await fsp.readFile(
    "build-tools/tools/nix/flake/packages/node-test-buildPhase.sh",
    "utf8",
  );
  if (!txt.includes("[node-test][phase]")) {
    throw new Error("node-test build phase must emit phase timing diagnostics");
  }
  for (const phase of [
    "patterns-decode",
    "pattern-args-encode",
    "test-discovery",
    "node-modules-link",
    "vitest-run",
  ]) {
    if (!txt.includes(phase)) {
      throw new Error(`node-test build phase must log ${phase}`);
    }
  }
});
