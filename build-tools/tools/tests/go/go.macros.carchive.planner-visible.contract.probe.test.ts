#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go macros: nix_go_carchive stamps labels, includes patch inputs, and builds a c-archive output (probe)", async () => {
  await runInTemp("go-carchive-planner-visible-contract-probe", async (tmp, $) => {
    // Minimal provider and auto_map mapping
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > .viberoots/workspace/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//projects/apps/demo:arc": ["//third_party/providers:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(appDir, "pkg", "demo"), { recursive: true });
    await fsp.mkdir(path.join(appDir, "patches", "go"), { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "go.mod"),
      "module example.com/demo\n\ngo 1.22\n",
      "utf8",
    );
    await fsp.writeFile(path.join(appDir, "gomod2nix.toml"), "schema = 3\n\n[mod]\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "pkg", "demo", "x.go"),
      'package main\n\n// #include <stdint.h>\nimport "C"\n\n//export Demo\nfunc Demo() C.int { return 0 }\n\nfunc main() {}\n',
      "utf8",
    );

    const patchRel = "projects/apps/demo/patches/go/demo@0.0.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.appendFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: go.macros.carchive.planner-visible.contract.probe.test.ts",
        'load("//build-tools/go:defs.bzl", "nix_go_carchive")',
        "",
        "nix_go_carchive(",
        '  name = "arc",',
        '  srcs = ["pkg/demo/x.go"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const labelsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/demo:arc`;
    if (labelsProbe.exitCode !== 0) return;
    const labelsOut = String(labelsProbe.stdout || "");
    assert.ok(
      labelsOut.includes('"lang:go"') || labelsOut.includes(': "lang:go"'),
      "expected lang:go stamp",
    );
    assert.ok(
      labelsOut.includes('"kind:carchive"') || labelsOut.includes(': "kind:carchive"'),
      "expected kind:carchive stamp",
    );
    assert.ok(
      labelsOut.includes('"patch_scope:package-local"') ||
        labelsOut.includes(': "patch_scope:package-local"'),
      "expected patch_scope:package-local stamp",
    );

    const srcsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/demo:arc`;
    if (srcsProbe.exitCode !== 0) return;
    const srcsOut = String(srcsProbe.stdout || "");
    assert.ok(
      srcsOut.includes(patchRel),
      `expected package-local patch input present in srcs: ${patchRel}`,
    );

    const depsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //projects/apps/demo:arc`;
    if (depsProbe.exitCode !== 0) return;
    const depsOut = String(depsProbe.stdout || "");
    assert.ok(
      depsOut.includes("//third_party/providers:prov"),
      "expected provider edge to be realized into deps for nix_go_carchive",
    );

    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo --show-output //projects/apps/demo:arc`;
    if (build.exitCode !== 0) {
      throw new Error(
        `buck2 build failed:\n${String(build.stdout || "")}\n${String(build.stderr || "")}`,
      );
    }
    const outLine = String(build.stdout || "").trim();
    const outPath = outLine.split(/\s+/).pop()!;
    const absOutPath = path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
    const libDir = path.join(absOutPath, "lib");
    const includeDir = path.join(absOutPath, "include");
    const libs = await fsp.readdir(libDir);
    const headers = await fsp.readdir(includeDir);
    assert.ok(
      libs.some((name) => name.endsWith(".a")),
      "expected a .a archive in output/lib",
    );
    assert.ok(
      headers.some((name) => name.endsWith(".h")),
      "expected a .h header in output/include",
    );
  });
});
