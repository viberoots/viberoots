#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { normalizeTargetLabel } from "../../lib/labels";
import { runInTemp } from "../lib/test-helpers";

function parseCqueryOne(stdout: string): any | null {
  const parsed = JSON.parse(stdout || "[]") as unknown;
  if (Array.isArray(parsed)) return parsed[0] || null;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const k = Object.keys(obj)[0];
    if (!k) return null;
    const v = obj[k];
    if (Array.isArray(v)) return v[0] || null;
    return v || null;
  }
  return null;
}

test("rust stubs realize provider edges deterministically (cquery)", async () => {
  await runInTemp("rust-stub-provider-edges", async (tmp, $) => {
    const rustDefs = await fsp.readFile(
      path.join(process.cwd(), "build-tools", "rust", "defs.bzl"),
      "utf8",
    );
    const rustDir = path.join(tmp, "build-tools", "rust");
    await fsp.mkdir(rustDir, { recursive: true });
    await fsp.writeFile(path.join(rustDir, "defs.bzl"), rustDefs, "utf8");

    const providersDir = path.join(tmp, "third_party", "providers");
    await fsp.mkdir(providersDir, { recursive: true });
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      [
        "MODULE_PROVIDERS = {",
        '  "//projects/apps/rustdemo:lib": [',
        '    "//projects/apps/rustdemo:prov_a",',
        '    "//projects/apps/rustdemo:prov_b",',
        '    "//projects/apps/rustdemo:prov_a",',
        "  ],",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const appDir = path.join(tmp, "projects", "apps", "rustdemo");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "src", "lib.rs"), "pub fn demo() {}\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "# test: rust.stub.provider-edges.deterministic.cquery.test.ts",
        'load("@prelude//:rules.bzl", "genrule")',
        'load("//build-tools/rust:defs.bzl", "rust_library")',
        "",
        'genrule(name = "prov_a", out = "prov_a.stamp", cmd = "echo a > $OUT", visibility = ["//visibility:public"])',
        'genrule(name = "prov_b", out = "prov_b.stamp", cmd = "echo b > $OUT", visibility = ["//visibility:public"])',
        "",
        "rust_library(",
        '  name = "lib",',
        '  srcs = ["src/lib.rs"],',
        '  deps = ["//projects/apps/rustdemo:prov_b"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const qSrcs = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/rustdemo:lib`;
    assert.equal(qSrcs.exitCode, 0, "buck2 cquery failed for rustdemo lib srcs");

    const node = parseCqueryOne(String(qSrcs.stdout || ""));
    const srcsRaw = (node && (node.srcs || (node["buck.srcs"] as any))) || [];
    const srcs = (Array.isArray(srcsRaw) ? srcsRaw : []).map((s) =>
      normalizeTargetLabel(String(s)),
    );

    assert.deepEqual(srcs, [
      "//projects/apps/rustdemo/src/lib.rs",
      "//projects/apps/rustdemo:prov_b",
      "//projects/apps/rustdemo:prov_a",
    ]);
  });
});
