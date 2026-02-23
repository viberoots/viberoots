#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("planner and runnable wiring include framework:vite for SSR", async () => {
  const root = process.cwd();
  const graphGenerator = await fsp.readFile(
    path.join(root, "build-tools", "tools", "nix", "graph-generator.nix"),
    "utf8",
  );
  const nodePlanner = await fsp.readFile(
    path.join(root, "build-tools", "tools", "nix", "planner", "node.nix"),
    "utf8",
  );
  const runnableHints = await fsp.readFile(
    path.join(root, "build-tools", "tools", "dev", "run-runnable-core.ts"),
    "utf8",
  );

  assert.match(graphGenerator, /framework:vite/);
  assert.match(nodePlanner, /framework:vite/);
  assert.match(
    nodePlanner,
    /missing framework label \(framework:express\|framework:next\|framework:vite\)/,
  );
  assert.match(runnableHints, /framework:vite/);
});
