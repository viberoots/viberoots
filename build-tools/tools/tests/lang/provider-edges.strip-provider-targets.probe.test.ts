#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("strip_provider_targets preserves order and removes only provider targets", async () => {
  await runInTemp("provider-edges-strip-probe", async (tmp, $) => {
    const targetsPath = path.join(tmp, "TARGETS");
    await fsp.appendFile(
      targetsPath,
      [
        "",
        "# test: provider-edges.strip-provider-targets.probe.test.ts",
        'load("//lang:defs_common.bzl", "strip_provider_targets_probe")',
        "",
        "strip_provider_targets_probe(",
        '  name = "strip",',
        "  items = [",
        '    "//a:x",',
        "    123,",
        '    "//third_party/providers:p1",',
        "    None,",
        '    "//b:y",',
        "  ],",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo --show-output //:strip`;

    const line = String(res.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)[0];
    assert.ok(line, "expected build output line");
    const outPath = line.split(/\s+/).slice(1).join(" ").trim();
    assert.ok(outPath, "expected output path");

    const txt = await fsp.readFile(path.join(tmp, outPath), "utf8");
    const lines = txt.trim().split("\n").filter(Boolean);
    assert.deepEqual(lines, ["//a:x", "123", "None", "//b:y"]);
  });
});
