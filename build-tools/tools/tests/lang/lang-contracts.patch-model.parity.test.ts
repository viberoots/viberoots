#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { patchInvalidationStrategyForLang } from "../../lib/lang-contracts";
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

function parseProbe(txt: string): { patchScope: string; glueOnApplyRemove: boolean } {
  const out: any = {};
  for (const raw of String(txt || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [k, v] = line.split(":", 2);
    out[k] = v;
  }
  return {
    patchScope: String(out.patch_scope || ""),
    glueOnApplyRemove: String(out.glue_on_apply_remove || "") === "true",
  };
}

test("lang patch invalidation model mapping is consistent (Starlark ↔ TS)", async () => {
  await runInTemp("lang-contracts-parity", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:lang_contracts.bzl", "lang_contract_probe")',
        "",
        'lang_contract_probe(name = "go", lang = "go")',
        'lang_contract_probe(name = "cpp", lang = "cpp")',
        'lang_contract_probe(name = "rust", lang = "rust")',
        'lang_contract_probe(name = "node", lang = "node")',
        'lang_contract_probe(name = "python", lang = "python")',
        "",
      ].join("\n"),
      "utf8",
    );

    for (const lang of ["go", "cpp", "rust", "node", "python"] as const) {
      const target = `//projects/apps/demo:${lang}`;
      const outPath = await buildOutPath(tmp, $, target);
      const probe = parseProbe(await fsp.readFile(outPath, "utf8"));
      const ts = patchInvalidationStrategyForLang(lang);
      assert.ok(ts, `missing TS contract entry for ${lang}`);
      assert.equal(probe.patchScope, ts.patchScope, `patchScope mismatch for ${lang}`);
      assert.equal(
        probe.glueOnApplyRemove,
        ts.glueOnApplyRemove,
        `glueOnApplyRemove mismatch for ${lang}`,
      );
    }
  });
});
