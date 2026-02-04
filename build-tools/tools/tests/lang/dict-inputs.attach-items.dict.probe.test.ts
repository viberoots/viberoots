#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("attach_items_dict_safe attaches items with stable sanitized keys and deterministic collisions (probe)", async () => {
  await runInTemp("dict-inputs-attach-items-probe", async (tmp, $) => {
    const pkgDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(pkgDir, { recursive: true });

    await fsp.writeFile(
      path.join(pkgDir, "TARGETS"),
      [
        'load("//build-tools/lang:defs_common.bzl", "dict_items_probe")',
        "",
        "dict_items_probe(",
        '  name = "probe_keys",',
        '  key_prefix = "__items__",',
        '  items = ["//a:b", "//a/b:c", "//a:b"],',
        '  initial = {"__items__/a-b": "user-value"},',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const so = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo --show-output //apps/demo:probe_keys`;
    if (so.exitCode !== 0) return;

    const line = String(so.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)[0];
    const outPath = (line || "").split(/\s+/).pop();
    if (!outPath) return;
    const abs = path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);

    const keys = (await fsp.readFile(abs, "utf8"))
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    assert.ok(
      keys.includes("__items__/a-b"),
      "expected user-provided key preserved: __items__/a-b",
    );
    assert.ok(
      keys.includes("__items__/a-b__1"),
      "expected deterministic collision suffix under __items__ namespace",
    );
    assert.ok(
      keys.includes("__items__/a-b-c"),
      "expected stable sanitized key for //a/b:c under __items__",
    );
  });
});
