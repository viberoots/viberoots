#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { lockfileBasenamesForLang } from "../../lib/lockfiles";
import { runInTemp } from "../lib/test-helpers";

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

function parseProbe(txt: string): string[] {
  return String(txt || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^basename:/, ""))
    .filter(Boolean);
}

test("lockfile basenames are consistent (Starlark ↔ TS)", async () => {
  await runInTemp("lockfile-contracts-parity", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/lang:lockfile_contracts.bzl", "lockfile_contract_probe")',
        "",
        'lockfile_contract_probe(name = "node", lang = "node")',
        'lockfile_contract_probe(name = "python", lang = "python")',
        "",
      ].join("\n"),
      "utf8",
    );

    for (const lang of ["node", "python"] as const) {
      const target = `//apps/demo:${lang}`;
      const outPath = await buildOutPath(tmp, $, target);
      const probe = parseProbe(await fsp.readFile(outPath, "utf8"));
      const ts = lockfileBasenamesForLang(lang);
      assert.ok(ts && ts.length > 0, `missing TS lockfile basenames for ${lang}`);
      assert.deepEqual(probe, ts, `lockfile basenames mismatch for ${lang}`);
    }
  });
});
