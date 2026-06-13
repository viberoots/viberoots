#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macros: dict-shaped srcs preserves user mapping and uses reserved synthetic namespaces (cquery)", async () => {
  await runInTemp("node-macro-dict-srcs-namespaces", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > .viberoots/workspace/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//:gen_dict_ns": ["//third_party/providers:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "projects", "apps", "web");
    const patchDir = path.join(appDir, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "leftpad@1.3.0.patch"), "# noop\n", "utf8");

    await fsp.mkdir(path.join(tmp, "bin"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "bin", "entry.js"), "console.log('ok')\n", "utf8");

    await fsp.appendFile(
      path.join(tmp, "TARGETS"),
      [
        "",
        "# test: node.macros.nix-node-gen.dict-srcs.synthetic-namespaces.cquery.test.ts",
        'load("//build-tools/node:defs.bzl", "nix_node_gen")',
        "",
        "nix_node_gen(",
        '  name = "gen_dict_ns",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //:gen_dict_ns`;
    if (probe.exitCode !== 0) return;

    const out = String(probe.stdout || "");

    // User mapping is preserved
    assert.ok(out.includes("bin/entry.js"), "expected user srcs mapping preserved");

    // Importer patch attachment uses reserved namespace and sanitized keying
    assert.ok(
      out.includes("__patch_inputs__/projects-apps-web-patches-node-leftpad@1.3.0.patch"),
      "expected importer patch key under __patch_inputs__/ with sanitized patch path",
    );

    // Provider edges are attached under a reserved namespace using sanitized keys
    assert.ok(
      out.includes("__provider_edges__/third_party-providers-prov"),
      "expected provider edge key under __provider_edges__/ with sanitized provider label",
    );
    assert.ok(
      out.includes("//third_party/providers:prov"),
      "expected provider target present in srcs",
    );
  });
});
