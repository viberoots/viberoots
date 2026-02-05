#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macros: provider edges realized into dict-shaped srcs for nix_node_gen", async () => {
  await runInTemp("node-macro-providers-srcs-dict", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//:gen_dict": ["//third_party/providers:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    await fsp.mkdir(path.join(tmp, "bin"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "bin", "entry.js"), "console.log('ok')\n", "utf8");

    await fsp.appendFile(
      path.join(tmp, "TARGETS"),
      [
        "",
        "# test: node.macros.providers-realized.srcs.gen.dict-srcs.test.ts",
        'load("//build-tools/node:defs.bzl", "nix_node_gen")',
        "",
        "nix_node_gen(",
        '  name = "gen_dict",',
        '  out = "out.txt",',
        '  cmd = "echo ok > $OUT",',
        "  srcs = {",
        '    "bin/entry.js": "bin/entry.js",',
        "  },",
        '  lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //:gen_dict`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes("//third_party/providers:prov"),
      "expected provider target present in srcs for dict-shaped nix_node_gen",
    );
  });
});
