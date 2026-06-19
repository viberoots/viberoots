#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function readRepoFile(relativePath: string): Promise<string> {
  for (const candidate of [relativePath, path.join("viberoots", relativePath)]) {
    try {
      return await fsp.readFile(candidate, "utf8");
    } catch {}
  }
  return await fsp.readFile(relativePath, "utf8");
}

test("top.wasm compatibility bridge wiring removed from active dev paths", async () => {
  const devWithWatch = await readRepoFile("viberoots/build-tools/tools/dev/dev-with-wasm-watch.ts");
  const nextDevScript = await readRepoFile(
    "viberoots/build-tools/tools/scaffolding/templates/ts/webapp-ssr-next/scripts/dev.mjs.jinja",
  );
  const nextDevHelper = await readRepoFile("build-tools/tools/tests/scaffolding/lib/next-dev.ts");

  assert.doesNotMatch(devWithWatch, /ensure-public-top-wasm/);
  assert.doesNotMatch(devWithWatch, /public\/top\.wasm/);
  assert.doesNotMatch(devWithWatch, /symlinkSync/);

  assert.doesNotMatch(nextDevScript, /ensure-public-top-wasm/);
  assert.doesNotMatch(nextDevHelper, /app\/wasm-contract\/top\.wasm/);
});

test("wasm dev shell wrappers use bash for bash-only flags", async () => {
  const devWithWatch = await readRepoFile("viberoots/build-tools/tools/dev/dev-with-wasm-watch.ts");
  const ensureAssets = await readRepoFile(
    "viberoots/build-tools/tools/dev/ensure-wasm-contract-assets.ts",
  );

  for (const source of [devWithWatch, ensureAssets]) {
    assert.match(source, /env\.BASH \|\| "bash"/);
    assert.doesNotMatch(source, /env\.SHELL \|\| "bash"/);
    assert.doesNotMatch(source, /process\.env\.SHELL \|\| "bash"/);
  }
});
