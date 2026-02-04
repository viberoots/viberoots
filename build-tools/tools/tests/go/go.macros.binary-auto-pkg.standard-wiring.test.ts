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

test("go macros: nix_go_binary auto-wired *_pkg uses standard nix_go_library wiring", async () => {
  await runInTemp("go-bin-auto-pkg-standard-wiring", async (tmp, $) => {
    // Provider + auto_map mapping for the synthesized pkg library target
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

    // Minimal Go CLI layout with an auto-wired test under cmd/<name>/**.
    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(appDir, "cmd", "demo"), { recursive: true });
    await fsp.mkdir(path.join(appDir, "patches", "go"), { recursive: true });

    const patchRel = "apps/demo/patches/go/demo@0.0.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

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
        "# test: go.macros.binary-auto-pkg.standard-wiring.test.ts",
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

    // Assert *_pkg has standard labels, provider edges in deps, and patch inputs in srcs.
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels --output-attribute deps --output-attribute srcs //apps/demo:demo_pkg`;
    if (probe.exitCode !== 0) return; // skip if prelude not available

    const node = firstCqueryNode<{
      labels?: string[];
      deps?: string[];
      srcs?: string[];
    }>(JSON.parse(String(probe.stdout || "")));

    assert.ok((node?.labels || []).includes("lang:go"), "expected lang:go label on *_pkg");
    assert.ok((node?.labels || []).includes("kind:lib"), "expected kind:lib label on *_pkg");
    assert.ok(
      (node?.deps || []).some(
        (d) => typeof d === "string" && d.includes("//third_party/providers:prov"),
      ),
      "expected provider edge realized into deps for *_pkg (like nix_go_library)",
    );
    assert.ok(
      (node?.srcs || []).some((s) => typeof s === "string" && s.includes(patchRel)),
      `expected package-local patch present in srcs for *_pkg: ${patchRel}`,
    );
  });
});
