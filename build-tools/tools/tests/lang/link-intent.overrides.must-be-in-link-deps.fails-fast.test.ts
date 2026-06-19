#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("link intent: link_closure_overrides keys must be present in link_deps (fails fast)", async () => {
  await runInTemp("link-intent-overrides-must-be-in-link-deps", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(appDir, { recursive: true });

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "genrule")',
        'load("@viberoots//build-tools/lang:link_intent_probe.bzl", "link_intent_probe")',
        "",
        'genrule(name = "b", out = "b.txt", cmd = "echo b > $OUT")',
        'genrule(name = "c", out = "c.txt", cmd = "echo c > $OUT")',
        "",
        "link_intent_probe(",
        '  name = "probe",',
        "  deps = [],",
        '  link_deps = [":b"],',
        '  link_closure_overrides = {":c": "transitive"},',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo //projects/apps/demo:probe`;
    if (res.exitCode === 0) {
      assert.fail("expected buck2 build to fail due to invalid link_closure_overrides");
    }
    const err = String(res.stderr || "");
    assert.ok(
      err.includes("link_closure_overrides keys must be present in link_deps"),
      "expected targeted link intent validation error",
    );
    assert.ok(err.includes(":c"), "expected missing dep label to appear in error text");
  });
});
