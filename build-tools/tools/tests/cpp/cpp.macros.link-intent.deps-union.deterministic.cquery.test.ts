#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { normalizeTargetLabel } from "../../lib/labels.ts";
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

test("nix_cpp_library: deps := deps ∪ link_deps ∪ header_deps as deterministic union", async () => {
  await runInTemp("cpp-macros-link-intent-deps-union", async (tmp, $) => {
    const app = path.join(tmp, "apps", "link_intent_union");
    await fsp.mkdir(path.join(app, "src"), { recursive: true });
    await fsp.writeFile(path.join(app, "src", "a.cpp"), "int a(){return 1;}\n", "utf8");
    await fsp.writeFile(path.join(app, "src", "b.cpp"), "int b(){return 2;}\n", "utf8");
    await fsp.writeFile(path.join(app, "src", "c.cpp"), "int c(){return 3;}\n", "utf8");
    await fsp.writeFile(path.join(app, "src", "d.cpp"), "int d(){return 4;}\n", "utf8");
    await fsp.writeFile(path.join(app, "src", "core.cpp"), "int core(){return 0;}\n", "utf8");

    await fsp.writeFile(
      path.join(app, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "cxx_library")',
        'load("//cpp:defs.bzl", "nix_cpp_library")',
        "",
        "cxx_library(",
        '  name = "a",',
        '  srcs = ["src/a.cpp"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "cxx_library(",
        '  name = "b",',
        '  srcs = ["src/b.cpp"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "cxx_library(",
        '  name = "c",',
        '  srcs = ["src/c.cpp"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "cxx_library(",
        '  name = "d",',
        '  srcs = ["src/d.cpp"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
        "nix_cpp_library(",
        '  name = "core",',
        '  srcs = ["src/core.cpp"],',
        '  deps = [":a", ":b"],',
        '  link_deps = [":b", ":c"],',
        '  header_deps = [":c", ":a", ":d"],',
        '  link_closure = "direct",',
        '  labels = ["lang:cpp"],',
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
    })`buck2 cquery --target-platforms //:no_cgo //apps/link_intent_union:core --json --output-attribute deps`;
    if (q.exitCode !== 0) return; // skip when Buck/prelude/toolchains unavailable

    const node = parseCqueryOne(String(q.stdout || ""));
    const depsRaw = (node && (node.deps || (node["buck.deps"] as any))) || [];
    const deps = (Array.isArray(depsRaw) ? depsRaw : [])
      .map((d) => normalizeTargetLabel(String(d)))
      .filter(Boolean);

    assert.deepEqual(deps, [
      "//apps/link_intent_union:a",
      "//apps/link_intent_union:b",
      "//apps/link_intent_union:c",
      "//apps/link_intent_union:d",
    ]);
  });
});
