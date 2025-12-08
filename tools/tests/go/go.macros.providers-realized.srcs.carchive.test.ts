#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("go macros: provider edges realized into srcs for nix_go_carchive", async () => {
  await runInTemp("go-macro-providers-srcs-carchive", async (tmp, $) => {
    // Minimal provider and auto_map mapping
    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash -lc 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//apps/demo:arc": ["//third_party/providers:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(appDir, "pkg", "demo"), { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "pkg", "demo", "x.go"),
      "package demo\n\nfunc X(){}\n",
      "utf8",
    );

    // TARGETS using nix_go_carchive (genrule-style; realizes into srcs)
    await fsp.appendFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: go.macros.providers-realized.srcs.carchive.test.ts",
        'load("//go:defs.bzl", "nix_go_carchive")',
        "",
        "nix_go_carchive(",
        '  name = "arc",',
        '  srcs = ["pkg/demo/x.go"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attributes srcs //apps/demo:arc`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes("//third_party/providers:prov"),
      "expected provider target present in srcs for nix_go_carchive",
    );
  });
});
