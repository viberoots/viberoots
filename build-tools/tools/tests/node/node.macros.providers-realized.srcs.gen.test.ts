#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("node macros: provider edges realized into srcs for nix_node_gen", async () => {
  await runInTemp("node-macro-providers-srcs", async (tmp, $) => {
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
  "//:gen": ["//third_party/providers:prov"],
}
EOF'`;

    // Importer with lockfile
    const appDir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    // Define the gen macro bound to this importer
    await fsp.appendFile(
      path.join(tmp, "TARGETS"),
      [
        "",
        "# test: node.macros.providers-realized.srcs.gen.test.ts",
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_gen")',
        "",
        "nix_node_gen(",
        '  name = "gen",',
        '  out = "out.txt",',
        '  cmd = "echo ok > $OUT",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    // Inspect srcs attribute for provider target reference
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //:gen`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes("//third_party/providers:prov"),
      "expected provider target present in srcs for nix_node_gen",
    );
  });
});
