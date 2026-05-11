#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function writeTargets(dir: string, body: string) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "TARGETS"), body, "utf8");
}

test("module_deps infers __surface labels and preserves explicit overrides", async () => {
  await runInTemp("webapp-module-dep-label-normalization", async (tmp, $) => {
    await writeTargets(
      path.join(tmp, "projects", "libs", "math-wasm"),
      [
        'load("@prelude//:rules.bzl", "genrule")',
        'genrule(name = "math-wasm__surface", out = "a.stamp", cmd = ": > $OUT", visibility = ["PUBLIC"])',
        'genrule(name = "custom__surface", out = "b.stamp", cmd = ": > $OUT", visibility = ["PUBLIC"])',
        "",
      ].join("\n"),
    );
    await writeTargets(
      path.join(tmp, "projects", "libs", "vendor"),
      [
        'load("@prelude//:rules.bzl", "genrule")',
        'genrule(name = "runtime_surface_v2", out = "v.stamp", cmd = ": > $OUT", visibility = ["PUBLIC"])',
        "",
      ].join("\n"),
    );
    await fsp.mkdir(path.join(tmp, "projects", "apps", "web"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "projects", "apps", "web", "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
    );
    await fsp.writeFile(path.join(tmp, "projects", "apps", "web", "index.html"), "<html></html>\n");
    await writeTargets(
      path.join(tmp, "projects", "apps", "web"),
      [
        'load("//build-tools/node:defs.bzl", "node_asset_stage")',
        "",
        "node_asset_stage(",
        '  name = "app",',
        '  app = "index.html",',
        '  module_deps = ["//projects/libs/math-wasm", "//projects/libs/math-wasm:custom"],',
        '  module_surface_deps = ["//projects/libs/vendor:runtime_surface_v2"],',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
      ].join("\n"),
    );

    const depsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //projects/apps/web:app`;
    assert.equal(
      depsProbe.exitCode,
      0,
      `buck2 deps probe failed:\n${String(depsProbe.stdout || "")}\n${String(depsProbe.stderr || "")}`,
    );
    const deps = String(depsProbe.stdout || "");
    assert.match(deps, /\/\/projects\/libs\/math-wasm:math-wasm__surface/);
    assert.match(deps, /\/\/projects\/libs\/math-wasm:custom__surface/);
    assert.match(deps, /\/\/projects\/libs\/vendor:runtime_surface_v2/);
  });
});

test("module_deps missing inferred surface fails with inferred label in diagnostics", async () => {
  await runInTemp("webapp-module-dep-label-normalization-missing", async (tmp, $) => {
    await fsp.mkdir(path.join(tmp, "projects", "apps", "web"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "projects", "apps", "web", "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
    );
    await fsp.writeFile(path.join(tmp, "projects", "apps", "web", "index.html"), "<html></html>\n");
    await writeTargets(
      path.join(tmp, "projects", "apps", "web"),
      [
        'load("//build-tools/node:defs.bzl", "node_asset_stage")',
        "",
        "node_asset_stage(",
        '  name = "app",',
        '  app = "index.html",',
        '  module_deps = ["//projects/libs/missing-wasm"],',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
      ].join("\n"),
    );
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //projects/apps/web:app`;
    assert.notEqual(probe.exitCode, 0);
    const merged = `${String(probe.stdout || "")}\n${String(probe.stderr || "")}`;
    assert.match(merged, /\/\/projects\/libs\/missing-wasm:missing-wasm__surface/);
  });
});
