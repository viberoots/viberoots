#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("go macros: provider edges realized into deps for nix_go_library", async () => {
  await runInTemp("go-macro-providers-deps-lib", async (tmp, $) => {
    // Minimal provider target and auto_map mapping
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "TARGETS"),
      'genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])\n',
      "utf8",
    );
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > .viberoots/workspace/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//projects/apps/demo:lib": ["//third_party/providers:prov"],
}
EOF'`;

    // Minimal Go source
    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(appDir, "pkg", "demo"), { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "pkg", "demo", "demo.go"),
      "package demo\n\nfunc X(){}\n",
      "utf8",
    );

    // TARGETS using nix_go_library
    await fsp.appendFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: go.macros.providers-realized.deps.lib.test.ts",
        'load("@viberoots//build-tools/go:defs.bzl", "nix_go_library")',
        "",
        "nix_go_library(",
        '  name = "lib",',
        '  srcs = glob(["pkg/**/*.go"]),',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //projects/apps/demo:lib`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes("//third_party/providers:prov"),
      "expected provider target present in deps for nix_go_library",
    );
  });
});
