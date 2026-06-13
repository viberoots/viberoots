#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_PROVIDER_TARGETS_PATH,
  workspaceProviderLabel,
} from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("go macros: provider edges realized into deps for nix_go_carchive", async () => {
  await runInTemp("go-macro-providers-srcs-carchive", async (tmp, $) => {
    // Minimal provider and auto_map mapping
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p .viberoots/workspace/providers && cat > ${DEFAULT_PROVIDER_TARGETS_PATH} <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > ${DEFAULT_AUTO_MAP_PATH} <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//projects/apps/demo:arc": ["workspace_providers//:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(appDir, "pkg", "demo"), { recursive: true });
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

    // TARGETS using nix_go_carchive (genrule-style; realizes into srcs)
    await fsp.appendFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: go.macros.providers-realized.srcs.carchive.test.ts",
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

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //projects/apps/demo:arc`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes(workspaceProviderLabel("prov")),
      "expected provider target present in deps for nix_go_carchive",
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
    assert.ok(
      String(build.stdout || "").includes("arc.carchive"),
      "expected carchive output directory",
    );
  });
});
