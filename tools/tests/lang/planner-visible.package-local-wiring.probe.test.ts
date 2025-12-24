#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("wire_package_local_planner_visible_stub: stamps patch_scope, includes patch inputs, and honors provider wiring options", async () => {
  await runInTemp("planner-visible-package-local-wiring-probe", async (tmp, $) => {
    // Minimal provider and auto_map mapping
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//apps/probe:stub_realize": ["//third_party/providers:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "apps", "probe");
    await fsp.mkdir(path.join(appDir, "patches", "cpp"), { recursive: true });
    const patchRel = "apps/probe/patches/cpp/demo@0.0.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: planner-visible.package-local-wiring.probe.test.ts",
        'load("//lang:auto_map.bzl", "MODULE_PROVIDERS")',
        'load("//lang:defs_common.bzl", "wire_package_local_planner_visible_stub")',
        "",
        'kw_strip = {"labels": [], "deps": []}',
        "wire_package_local_planner_visible_stub(",
        '  name = "stub_strip",',
        '  out = "stub_strip.stamp",',
        "  kwargs = kw_strip,",
        '  lang = "cpp",',
        '  kind = "test",',
        '  deps = ["//third_party/providers:prov"],',
        "  strip_providers_from_deps = True,",
        ")",
        "",
        'kw_realize = {"labels": [], "deps": []}',
        "wire_package_local_planner_visible_stub(",
        '  name = "stub_realize",',
        '  out = "stub_realize.stamp",',
        "  kwargs = kw_realize,",
        '  lang = "cpp",',
        '  kind = "test",',
        "  MODULE_PROVIDERS = MODULE_PROVIDERS,",
        '  realize_providers_into = "srcs",',
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

    const qLabels = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo //apps/probe:stub_strip --json --output-attribute labels`;
    assert.equal(qLabels.exitCode, 0, "buck2 cquery failed for stub_strip labels");
    const nodeLabels = parseCqueryOne(String(qLabels.stdout || ""));
    const labelsRaw =
      (nodeLabels && (nodeLabels.labels || (nodeLabels["buck.labels"] as any))) || [];
    const labels = (Array.isArray(labelsRaw) ? labelsRaw : []).map(String);
    assert.ok(
      labels.includes("patch_scope:package-local"),
      "expected patch_scope:package-local label",
    );
    assert.ok(labels.includes("lang:cpp"), "expected lang:cpp label");
    assert.ok(labels.includes("kind:test"), "expected kind:test label");

    const qSrcs = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo //apps/probe:stub_strip --json --output-attribute srcs`;
    assert.equal(qSrcs.exitCode, 0, "buck2 cquery failed for stub_strip srcs");
    assert.ok(
      String(qSrcs.stdout || "").includes(patchRel),
      `expected package-local patch path present in srcs: ${patchRel}`,
    );

    const qDepsStrip = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo //apps/probe:stub_strip --json --output-attribute deps`;
    assert.equal(qDepsStrip.exitCode, 0, "buck2 cquery failed for stub_strip deps");
    assert.ok(
      !String(qDepsStrip.stdout || "").includes("//third_party/providers:prov"),
      "expected provider dep to be stripped from deps",
    );

    const qSrcsRealize = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo //apps/probe:stub_realize --json --output-attribute srcs`;
    assert.equal(qSrcsRealize.exitCode, 0, "buck2 cquery failed for stub_realize srcs");
    assert.ok(
      String(qSrcsRealize.stdout || "").includes("//third_party/providers:prov"),
      "expected provider target realized into srcs",
    );
  });
});
