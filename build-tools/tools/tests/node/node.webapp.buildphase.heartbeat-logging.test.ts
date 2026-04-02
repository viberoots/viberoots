#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node-webapp build phase includes heartbeat and phase logs", async () => {
  const txt = await fsp.readFile("build-tools/tools/nix/flake/packages/node-webapp.nix", "utf8");
  if (!txt.includes("[node-webapp][phase]")) {
    throw new Error("node-webapp.nix must emit phase logs for profiling");
  }
  if (!txt.includes("[node-webapp][phase-diag]")) {
    throw new Error("node-webapp.nix must expose env-gated subphase timing diagnostics");
  }
  if (!txt.includes("[node-webapp][heartbeat] webapp-build running")) {
    throw new Error("node-webapp.nix must emit heartbeat logs while webapp build runs");
  }
  for (const phase of [
    "sync-module-contracts",
    "vite-build-static",
    "vite-build-client",
    "vite-build-ssr",
    "next-build",
    "install-copy-dist",
  ]) {
    if (!txt.includes(phase)) {
      throw new Error(`node-webapp.nix must include ${phase} timing diagnostics`);
    }
  }
});
