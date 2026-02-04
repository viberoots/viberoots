#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function parseLines(txt: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of txt.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    out.set(line.slice(0, idx), line.slice(idx + 1));
  }
  return out;
}

test("merge_provider_edges attaches provider edges to dict-shaped inputs (probe)", async () => {
  await runInTemp("provider-edges-merge-dict-safe-probe", async (tmp, $) => {
    const targetsPath = path.join(tmp, "TARGETS");
    await fsp.appendFile(
      targetsPath,
      [
        "",
        "# test: provider-edges.merge.dict-safe.probe.test.ts",
        'load("//lang:defs_common.bzl", "merge_provider_edges_dict_safe_probe")',
        "",
        "merge_provider_edges_dict_safe_probe(",
        '  name = "dict_safe",',
        '  target_name = "t",',
        '  providers = ["//third_party/providers:p1", "//third_party/providers:p2", "//third_party/providers:p1"],',
        '  deps = ["//a:x", "//third_party/providers:p2"],',
        '  base_dict = {"user_key": "local.txt"},',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo --show-output //:dict_safe`;

    const line = String(res.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)[0];
    assert.ok(line, "expected build output line");
    const outPath = line.split(/\s+/).slice(1).join(" ").trim();
    assert.ok(outPath, "expected output path");

    const txt = await fsp.readFile(path.join(tmp, outPath), "utf8");
    const entries = parseLines(txt);
    const keys = Array.from(entries.keys());
    const values = Array.from(entries.values());

    assert.ok(keys.includes("user_key"), "expected base dict entry preserved");
    assert.ok(keys.includes("__provider_edges__/a-x"), "expected dep entry attached");
    assert.ok(keys.includes("__provider_edges__/third_party-providers-p1"));
    assert.ok(keys.includes("__provider_edges__/third_party-providers-p2"));

    assert.deepEqual(
      values.sort(),
      ["//a:x", "//third_party/providers:p1", "//third_party/providers:p2", "local.txt"].sort(),
    );
  });
});
