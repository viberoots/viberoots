#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node-webapp build phase includes heartbeat and phase logs", async () => {
  const txt = await fsp.readFile("build-tools/tools/nix/flake/packages/node-webapp.nix", "utf8");
  if (!txt.includes("[node-webapp][phase]")) {
    throw new Error("node-webapp.nix must emit phase logs for profiling");
  }
  if (!txt.includes("[node-webapp][heartbeat] vite-build running")) {
    throw new Error("node-webapp.nix must emit heartbeat logs while vite build runs");
  }
});
