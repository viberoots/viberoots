#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function resolveRepoFile(rel: string): Promise<string> {
  const normalized = rel.replace(/^viberoots\//, "");
  for (const candidate of [normalized, path.join("viberoots", normalized)]) {
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {}
  }
  return rel;
}

test("nix zx-wrapper discovers zx-init in standalone and consumer viberoots layouts", async () => {
  const zxWrapperNix = await resolveRepoFile("viberoots/build-tools/tools/nix/lib/zx-wrapper.nix");
  const source = await fsp.readFile(zxWrapperNix, "utf8");

  assert.match(source, /\$_search\/build-tools\/tools\/dev\/zx-init\.mjs/);
  assert.match(source, /\$_search\/viberoots\/build-tools\/tools\/dev\/zx-init\.mjs/);
  assert.match(source, /\$_search\/\.viberoots\/current\/build-tools\/tools\/dev\/zx-init\.mjs/);
  assert.match(source, /break 2/);
  assert.match(source, /export PATH=\$\{pkgs\.yq\}\/bin:/);

  assert.ok(
    source.indexOf("$_search/viberoots/build-tools/tools/dev/zx-init.mjs") <
      source.indexOf("$_search/.viberoots/current/build-tools/tools/dev/zx-init.mjs"),
    "nested viberoots checkout should be preferred before .viberoots/current fallback",
  );
});
