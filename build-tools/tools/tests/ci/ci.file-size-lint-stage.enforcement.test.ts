#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("ci run-stage wires strict file-size lint args without allow-known bypass", async () => {
  const txt = await fsp.readFile("build-tools/tools/ci/run-stage.ts", "utf8");
  assert.ok(
    txt.includes('case "file-size-lint"'),
    "expected run-stage to expose a file-size-lint stage",
  );
  assert.ok(
    txt.includes("file-size-lint.ts"),
    "expected file-size-lint stage to invoke file-size-lint.ts",
  );
  assert.ok(
    txt.includes("--scope=source") && txt.includes("--fail=true"),
    "expected file-size-lint stage to pass strict source-scope fail args",
  );
  assert.equal(
    txt.includes("--scope=ssr-tests"),
    false,
    "expected file-size-lint stage to avoid legacy SSR-only scope wiring",
  );
  assert.equal(
    txt.includes("--allow-known"),
    false,
    "expected file-size-lint stage to avoid --allow-known bypass",
  );
});
