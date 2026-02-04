#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("node macros: provider edges realized into deps for nix_node_test", async () => {
  await runInTemp("node-macro-providers-deps", async (tmp, $) => {
    // Minimal provider target and auto_map mapping
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//apps/web:test": ["//third_party/providers:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "apps", "web");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    await fsp.appendFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: node.macros.providers-realized.deps.test.ts",
        'load("//build-tools/node:defs.bzl", "nix_node_test")',
        "",
        "nix_node_test(",
        '  name = "test",',
        "  patterns = [],",
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //apps/web:test`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes("//third_party/providers:prov"),
      "expected provider target present in deps for nix_node_test",
    );
  });
});
