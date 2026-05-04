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

test("nix_python_extension_module: deps := deps ∪ link_deps ∪ header_deps as deterministic union", async () => {
  await runInTemp("python-pyext-link-intent-deps-union", async (tmp, $) => {
    const app = path.join(tmp, "projects", "apps", "link_intent_union");
    await fsp.mkdir(path.join(app, "native"), { recursive: true });
    await fsp.writeFile(path.join(app, "native", "ext.c"), "int x(){return 1;}\n", "utf8");
    await fsp.writeFile(path.join(app, "uv.lock"), "# uv lock\n", "utf8");

    await fsp.writeFile(
      path.join(app, "TARGETS"),
      [
        'load("//build-tools/python:defs.bzl", "nix_python_extension_module")',
        "",
        "filegroup(",
        '  name = "a",',
        "  srcs = [],",
        '  visibility = ["PUBLIC"],',
        ")",
        "filegroup(",
        '  name = "b",',
        "  srcs = [],",
        '  visibility = ["PUBLIC"],',
        ")",
        "filegroup(",
        '  name = "c",',
        "  srcs = [],",
        '  visibility = ["PUBLIC"],',
        ")",
        "filegroup(",
        '  name = "d",',
        "  srcs = [],",
        '  visibility = ["PUBLIC"],',
        ")",
        "",
        "nix_python_extension_module(",
        '  name = "ext",',
        '  lockfile_label = "lockfile:projects/apps/link_intent_union/uv.lock#projects/apps/link_intent_union",',
        '  module = "demo._native",',
        '  srcs = ["native/ext.c"],',
        '  deps = [":a", ":b"],',
        '  link_deps = [":b", ":c"],',
        '  header_deps = [":c", ":a", ":d"],',
        '  link_closure = "direct",',
        '  labels = ["lang:python"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const q = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo //projects/apps/link_intent_union:ext --json --output-attribute deps`;
    if (q.exitCode !== 0) return; // skip when Buck/prelude/toolchains unavailable

    const node = parseCqueryOne(String(q.stdout || ""));
    const depsRaw = (node && (node.deps || (node["buck.deps"] as any))) || [];
    const deps = (Array.isArray(depsRaw) ? depsRaw : [])
      .map((d) => normalizeTargetLabel(String(d)))
      .filter(Boolean);

    assert.deepEqual(deps, [
      "//projects/apps/link_intent_union:a",
      "//projects/apps/link_intent_union:b",
      "//projects/apps/link_intent_union:c",
      "//projects/apps/link_intent_union:d",
    ]);
  });
});
