#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import * as fsp from "node:fs/promises";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_PROVIDER_TARGETS_PATH,
  workspaceProviderLabel,
} from "../../lib/workspace-state-paths";
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

function count(arr: string[], s: string): number {
  return arr.filter((x) => x === s).length;
}

test("go macros: nix_go_binary auto-wires *_pkg and *_test targets with standard wiring", async () => {
  await runInTemp("go-bin-auto-wired-targets-exist-and-wired", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p .viberoots/workspace/providers && cat > ${DEFAULT_PROVIDER_TARGETS_PATH} <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > ${DEFAULT_AUTO_MAP_PATH} <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//projects/apps/demo:demo_pkg": ["workspace_providers//:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(appDir, "cmd", "demo"), { recursive: true });
    await fsp.mkdir(path.join(appDir, "patches", "go"), { recursive: true });

    const patchRel = "projects/apps/demo/patches/go/demo@0.0.0.patch";
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
        "# test: go.macros.binary-auto-wired.targets-exist-and-wired.cquery.test.ts",
        'load("@viberoots//build-tools/go:defs.bzl", "nix_go_binary")',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps --output-attribute srcs //projects/apps/demo:demo_pkg`;
    if (probePkg.exitCode !== 0) return; // skip when Buck/prelude/toolchains unavailable

    const pkg = firstCqueryNode<{ deps?: string[]; srcs?: string[] }>(
      JSON.parse(String(probePkg.stdout || "")),
    );
    const pkgDeps = pkg?.deps || [];
    const provCount = pkgDeps.filter(
      (d) => typeof d === "string" && d.includes(workspaceProviderLabel("prov")),
    ).length;
    assert.equal(provCount, 1, "expected provider edge present exactly once in *_pkg deps");
    assert.ok(
      (pkg?.srcs || []).some((s) => typeof s === "string" && s.includes(patchRel)),
      `expected package-local patch present in *_pkg srcs: ${patchRel}`,
    );

    const probeTest = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute library //projects/apps/demo:demo_test`;
    const node = firstCqueryNode<{ library?: string | null }>(
      JSON.parse(String(probeTest.stdout || "")),
    );
    assert.ok(node != null, "expected auto-wired *_test target to exist");
    assert.ok(
      typeof node?.library === "string" && node.library.includes("demo_pkg"),
      "expected auto-wired *_test to reference *_pkg via library attribute",
    );
  });
});
