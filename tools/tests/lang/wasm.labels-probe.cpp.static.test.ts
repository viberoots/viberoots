#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("labels-probe: cpp static stamps lang/kind/variant", async () => {
  await runInTemp("probe-cpp-static", async (tmp, $) => {
    const dir = path.join(tmp, "tests", "labels");
    await fs.mkdirp(dir);
    await fs.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//lang:defs_common.bzl", "wasm_labels_probe")',
        "",
        "wasm_labels_probe(",
        '  name = "cpp_static",',
        '  lang = "cpp",',
        '  variant = "static",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    const query = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --show-output //tests/labels:cpp_static.labels.txt`;
    if (query.exitCode !== 0) return;
    const out =
      String(query.stdout || "")
        .trim()
        .split(/\s+/)
        .pop() || "";
    const txt = await fs.readFile(out, "utf8");
    assert.match(txt, /lang:cpp/);
    assert.match(txt, /kind:wasm/);
    assert.match(txt, /wasm:static/);
  });
});
