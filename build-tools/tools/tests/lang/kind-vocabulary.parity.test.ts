#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { runInTemp } from "../lib/test-helpers";
import { ALLOWED_KIND_VALUES } from "../../lib/kind-vocabulary";

async function buildOutPath(tmp: string, $: any, target: string): Promise<string> {
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`buck2 build --show-output ${target}`;
  assert.equal(
    res.exitCode,
    0,
    `buck2 build failed for ${target}:\n${String(res.stderr || res.stdout)}`,
  );
  const out = String(res.stdout || "")
    .trim()
    .split("\n");
  const line = out.find((l) => l.includes(target)) || out[out.length - 1] || "";
  const last = line.trim().split(/\s+/).pop() || "";
  assert.ok(last, `unable to parse output path from: ${line}`);
  return path.isAbsolute(last) ? last : path.resolve(tmp, last);
}

function parseKindValues(txt: string): string[] {
  return String(txt || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

test("kind vocabulary is consistent (Starlark ↔ TS)", async () => {
  await runInTemp("kind-vocabulary-parity", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//lang:kind_vocabulary.bzl", "kind_vocabulary_probe")',
        "",
        'kind_vocabulary_probe(name = "kinds")',
        "",
      ].join("\n"),
      "utf8",
    );

    const outPath = await buildOutPath(tmp, $, "//apps/demo:kinds");
    const starlarkKinds = parseKindValues(await fsp.readFile(outPath, "utf8")).sort();
    const tsKinds = [...ALLOWED_KIND_VALUES].sort();
    assert.deepEqual(starlarkKinds, tsKinds);
  });
});
