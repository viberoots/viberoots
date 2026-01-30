#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("realize_provider_edges merges deterministically for both list and kwargs base", async () => {
  await runInTemp("provider-edges-realize-probe", async (tmp, $) => {
    const targetsPath = path.join(tmp, "TARGETS");
    await fsp.appendFile(
      targetsPath,
      [
        "",
        "# test: provider-edges.realize.into.kwargs-and-list.test.ts",
        'load("//lang:defs_common.bzl", "merge_provider_edges_list_probe", "realize_provider_edges_probe")',
        "",
        "realize_provider_edges_probe(",
        '  name = "list_base",',
        '  target_name = "t",',
        '  providers = ["//third_party/providers:p1", "//third_party/providers:p2", "//third_party/providers:p1"],',
        '  base_list = ["//a:x", "//third_party/providers:p2"],',
        '  into = "deps",',
        "  use_kwargs = False,",
        ")",
        "",
        "merge_provider_edges_list_probe(",
        '  name = "merge_list_base",',
        '  target_name = "t",',
        '  providers = ["//third_party/providers:p1", "//third_party/providers:p2", "//third_party/providers:p1"],',
        '  base_list = ["//a:x", "//third_party/providers:p2"],',
        '  into = "deps",',
        ")",
        "",
        "realize_provider_edges_probe(",
        '  name = "kwargs_base",',
        '  target_name = "t",',
        '  providers = ["//third_party/providers:p1", "//third_party/providers:p2", "//third_party/providers:p1"],',
        '  base_list = ["//a:x", "//third_party/providers:p2"],',
        '  into = "srcs",',
        "  use_kwargs = True,",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo --show-output //:list_base //:kwargs_base //:merge_list_base`;

    const txt = String(res.stdout || "").trim();
    const outputs = new Map<string, string>();
    for (const line of txt.split("\n").filter(Boolean)) {
      const idx = line.indexOf(" ");
      if (idx > 0) outputs.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    }

    const listOut = outputs.get("root//:list_base");
    const kwargsOut = outputs.get("root//:kwargs_base");
    const mergeListOut = outputs.get("root//:merge_list_base");
    assert.ok(listOut, "expected output for list_base");
    assert.ok(kwargsOut, "expected output for kwargs_base");
    assert.ok(mergeListOut, "expected output for merge_list_base");

    const listLines = (await fsp.readFile(path.join(tmp, listOut!), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean);
    const kwargsLines = (await fsp.readFile(path.join(tmp, kwargsOut!), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean);
    const mergeListLines = (await fsp.readFile(path.join(tmp, mergeListOut!), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean);

    const expected = ["//a:x", "//third_party/providers:p2", "//third_party/providers:p1"];
    assert.deepEqual(listLines, expected, "list base merge should be stable and deduped");
    assert.deepEqual(kwargsLines, expected, "kwargs base merge should be stable and deduped");
    assert.deepEqual(mergeListLines, expected, "merge_provider_edges should preserve ordering");
  });
});
