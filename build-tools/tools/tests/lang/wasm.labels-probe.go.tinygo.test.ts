#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("labels-probe: go tinygo stamps build-tools/lang/kind/variant", async () => {
  await runInTemp("probe-go-tinygo", async (tmp, $) => {
    const dir = path.join(tmp, "tests", "labels");
    await fs.mkdirp(dir);
    await fs.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/lang:defs_common.bzl", "wasm_labels_probe")',
        "",
        "wasm_labels_probe(",
        '  name = "go_tiny",',
        '  lang = "go",',
        '  variant = "tinygo",',
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
    })`buck2 build --show-output //tests/labels:go_tiny`;
    if (query.exitCode !== 0) return;
    const out =
      String(query.stdout || "")
        .trim()
        .split(/\s+/)
        .pop() || "";
    const absOut = path.isAbsolute(out) ? out : path.join(tmp, out);
    const txt = await fs.readFile(absOut, "utf8");
    assert.match(txt, /lang:go/);
    assert.match(txt, /kind:wasm/);
    assert.match(txt, /wasm:tinygo/);
  });
});
