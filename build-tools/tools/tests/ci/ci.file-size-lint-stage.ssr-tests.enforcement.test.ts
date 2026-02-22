#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("ci run-stage wires strict SSR test-module file-size lint args", async () => {
  const txt = await fsp.readFile("build-tools/tools/ci/run-stage.ts", "utf8");
  assert.ok(
    txt.includes("--scope=ssr-tests") && txt.includes("--fail=true"),
    "expected file-size-lint stage to pass strict SSR test-module args",
  );
});
