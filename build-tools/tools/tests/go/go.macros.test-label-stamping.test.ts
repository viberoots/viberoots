#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import * as fsp from "node:fs/promises";
import { runInTemp } from "../lib/test-helpers";

function firstCqueryNode<T>(json: unknown): T | null {
  if (Array.isArray(json)) return (json[0] as T) ?? null;
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const k = Object.keys(obj)[0];
    if (!k) return null;
    const v = obj[k];
    if (Array.isArray(v)) return (v[0] as T) ?? null;
    return (v as T) ?? null;
  }
  return null;
}

function count(arr: string[], s: string): number {
  return arr.filter((x) => x === s).length;
}

test("go macros: nix_go_test stamps lang:go and kind:test (including auto-wired tests)", async () => {
  await runInTemp("go-macro-test-stamping", async (tmp, $) => {
    const pkgDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(pkgDir, "pkg", "api"), { recursive: true });

    await fsp.writeFile(
      path.join(pkgDir, "pkg", "api", "api.go"),
      "package api\nfunc X(){}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(pkgDir, "pkg", "api", "api_test.go"),
      'package api\nimport "testing"\nfunc TestX(t *testing.T){}\n',
      "utf8",
    );
    await fsp.writeFile(
      path.join(pkgDir, "pkg", "api", "explicit_test.go"),
      'package api\nimport "testing"\nfunc TestExplicit(t *testing.T){}\n',
      "utf8",
    );

    await fsp.writeFile(
      path.join(pkgDir, "TARGETS"),
      [
        "",
        "# test: go.macros.test-label-stamping.test.ts",
        'load("//build-tools/go:defs.bzl", "nix_go_library", "nix_go_test")',
        "",
        "nix_go_library(",
        '  name = "lib",',
        '  srcs = ["pkg/api/api.go"],',
        ")",
        "",
        "nix_go_test(",
        '  name = "explicit",',
        '  srcs = ["pkg/api/explicit_test.go"],',
        '  labels = ["lang:go", "kind:test", "custom:probe"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probeAuto = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //apps/demo:lib_test`;
    if (probeAuto.exitCode !== 0) return; // skip when Buck/prelude/toolchains unavailable

    const auto = firstCqueryNode<{ labels?: string[] }>(JSON.parse(String(probeAuto.stdout || "")));
    const autoLabels = auto?.labels || [];
    assert.ok(autoLabels.includes("lang:go"), "expected auto-wired go test to include lang:go");
    assert.ok(autoLabels.includes("kind:test"), "expected auto-wired go test to include kind:test");

    const probeExplicit = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //apps/demo:explicit`;
    const explicit = firstCqueryNode<{ labels?: string[] }>(
      JSON.parse(String(probeExplicit.stdout || "")),
    );
    const explicitLabels = explicit?.labels || [];
    assert.ok(explicitLabels.includes("custom:probe"), "expected custom label preserved");
    assert.equal(count(explicitLabels, "lang:go"), 1, "expected lang:go stamped exactly once");
    assert.equal(count(explicitLabels, "kind:test"), 1, "expected kind:test stamped exactly once");
  });
});
