#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const REPO_ROOT = process.cwd();

async function readRepoFile(relativePath: string): Promise<string> {
  return await fsp.readFile(path.join(REPO_ROOT, relativePath), "utf8");
}

test("top.wasm compatibility bridge wiring removed from active dev paths", async () => {
  const devWithWatch = await readRepoFile("build-tools/tools/dev/dev-with-wasm-watch.ts");
  const nextDevScript = await readRepoFile(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-next/scripts/dev.mjs.jinja",
  );
  const nextDevHelper = await readRepoFile("build-tools/tools/tests/scaffolding/lib/next-dev.ts");

  assert.doesNotMatch(devWithWatch, /ensure-public-top-wasm/);
  assert.doesNotMatch(devWithWatch, /public\/top\.wasm/);
  assert.doesNotMatch(devWithWatch, /symlinkSync/);

  assert.doesNotMatch(nextDevScript, /ensure-public-top-wasm/);
  assert.doesNotMatch(nextDevHelper, /app\/wasm-contract\/top\.wasm/);
});
