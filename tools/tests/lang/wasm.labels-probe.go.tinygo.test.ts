#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("labels-probe: go tinygo stamps lang/kind/variant", async () => {
  await runInTemp("probe-go-tinygo", async (tmp, $) => {
    const dir = path.join(tmp, "tests", "labels");
    await fs.mkdirp(dir);
    await fs.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//lang:defs_common.bzl", "wasm_labels_probe")',
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
    })`buck2 build --show-output //tests/labels:go_tiny.labels.txt`;
    if (query.exitCode !== 0) return;
    const out =
      String(query.stdout || "")
        .trim()
        .split(/\s+/)
        .pop() || "";
    const txt = await fs.readFile(out, "utf8");
    assert.match(txt, /lang:go/);
    assert.match(txt, /kind:wasm/);
    assert.match(txt, /wasm:tinygo/);
  });
});
