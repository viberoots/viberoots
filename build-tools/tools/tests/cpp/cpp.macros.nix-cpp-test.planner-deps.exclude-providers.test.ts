#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { normalizeTargetLabel } from "../../lib/labels";

test("nix_cpp_test planner stub deps exclude //third_party/providers:* targets", async () => {
  await runInTemp("cpp-nix-cpp-test-planner-deps", async (tmp, $) => {
    const app = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(app, "src"), { recursive: true });
    await fsp.writeFile(path.join(app, "src", "main.cpp"), "int main(){return 0;}\n", "utf8");
    await fsp.writeFile(path.join(app, "src", "helper.cpp"), "int helper(){return 1;}\n", "utf8");

    const patchRel = "projects/apps/demo/patches/cpp/demo@0.0.0.patch";
    await fsp.mkdir(path.join(tmp, "projects", "apps", "demo", "patches", "cpp"), {
      recursive: true,
    });
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(app, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "cxx_library")',
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_test")',
        "",
        "cxx_library(",
        '  name = "helper",',
        '  srcs = ["src/helper.cpp"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
        "nix_cpp_test(",
        '  name = "demo_test",',
        '  srcs = ["src/main.cpp"],',
        '  deps = [":helper", "//third_party/providers:nix_pkgs_zlib"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const parseCqueryOne = (stdout: string): any | null => {
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
    };

    const q = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms //:no_cgo //projects/apps/demo:demo_test__planner --json --output-attribute deps`;

    const node = parseCqueryOne(String(q.stdout || ""));
    const depsRaw = (node && (node.deps || (node["buck.deps"] as any))) || [];
    const deps = (Array.isArray(depsRaw) ? depsRaw : [])
      .map((d) => normalizeTargetLabel(String(d)))
      .filter(Boolean);

    assert.ok(deps.includes("//projects/apps/demo:helper"), "expected helper dep on planner stub");
    assert.ok(
      !deps.includes("//third_party/providers:nix_pkgs_zlib"),
      "expected provider deps to be stripped from planner stub deps",
    );

    const s = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms //:no_cgo //projects/apps/demo:demo_test__planner --json --output-attribute srcs`;

    const node2 = parseCqueryOne(String(s.stdout || ""));
    const srcsRaw = (node2 && (node2.srcs || (node2["buck.srcs"] as any))) || [];
    const srcs = (Array.isArray(srcsRaw) ? srcsRaw : []).map(String);
    assert.ok(
      srcs.some((p) => p === patchRel || p.endsWith(patchRel) || p.includes(patchRel)),
      `expected package-local patch file to be present in planner stub srcs: ${patchRel}`,
    );
  });
});
