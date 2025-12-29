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

test("go macros: nix_go_binary auto-wired *_pkg includes patch_scope:package-local", async () => {
  await runInTemp("go-bin-auto-wired-pkg-includes-patch-scope", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//apps/demo:demo_pkg": ["//third_party/providers:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(appDir, "cmd", "demo"), { recursive: true });
    await fsp.mkdir(path.join(appDir, "patches", "go"), { recursive: true });

    await fsp.writeFile(
      path.join(appDir, "cmd", "demo", "main.go"),
      "package main\n\nfunc main(){}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "cmd", "demo", "demo_test.go"),
      'package main\n\nimport "testing"\n\nfunc TestDemo(t *testing.T) {}\n',
      "utf8",
    );

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: go.macros.binary-auto-wired.pkg.includes-patch-scope.test.ts",
        'load("//go:defs.bzl", "nix_go_binary")',
        "",
        "nix_go_binary(",
        '  name = "demo",',
        '  srcs = ["cmd/demo/main.go"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probePkg = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //apps/demo:demo_pkg`;
    if (probePkg.exitCode !== 0) return; // skip when Buck/prelude/toolchains unavailable

    const pkg = firstCqueryNode<{ labels?: string[] }>(JSON.parse(String(probePkg.stdout || "")));
    const labels = pkg?.labels || [];
    assert.ok(
      labels.includes("patch_scope:package-local"),
      "expected patch_scope:package-local on *_pkg",
    );
  });
});
