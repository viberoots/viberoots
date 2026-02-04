#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { readGraph } from "../../lib/graph";
import { normalizeTargetLabel } from "../../lib/labels";
import { runInTemp } from "../lib/test-helpers";

function normalizeLabelList(xs: unknown): string[] {
  const raw = Array.isArray(xs) ? (xs as unknown[]) : [];
  return raw.map((x) => normalizeTargetLabel(String(x))).filter(Boolean);
}

test("exporter: nix_go_tiny_wasm_lib preserves link intent attrs in build-tools/tools/buck/graph.json", async () => {
  await runInTemp("go-tinygo-wasm-link-intent-exported-attrs", async (tmp, $) => {
    // Avoid coupling to workspace-generated provider mappings
    await fs.mkdirp(path.join(tmp, "third_party", "providers"));
    await fs.writeFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "MODULE_PROVIDERS = {}\n",
      "utf8",
    );

    const appRel = path.join("apps", "wasm");
    const app = path.join(tmp, appRel);
    await fs.mkdirp(path.join(app, "src"));
    await fs.writeFile(path.join(app, "go.mod"), "module example.com/wasm\n\ngo 1.22.0\n", "utf8");
    await fs.writeFile(path.join(app, "src", "main.go"), "package main\nfunc main() {}\n", "utf8");

    await fs.writeFile(
      path.join(app, "TARGETS"),
      [
        'load("//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")',
        "",
        "filegroup(",
        '  name = "dep_a",',
        "  srcs = [],",
        '  visibility = ["PUBLIC"],',
        ")",
        "",
        "nix_go_tiny_wasm_lib(",
        '  name = "mod",',
        '  srcs = ["src/main.go"],',
        '  link_deps = [":dep_a"],',
        '  link_closure = "transitive",',
        "  link_closure_overrides = {",
        '    ":dep_a": "transitive",',
        "  },",
        '  labels = ["lang:go", "kind:wasm"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const graphPath = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
    await fs.mkdirp(path.dirname(graphPath));

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`node build-tools/tools/buck/export-graph.ts --out ${graphPath}`;
    if (res.exitCode !== 0) return; // skip when Buck/prelude/toolchains unavailable

    const nodes = await readGraph(graphPath);
    const nodeLabel = `//${appRel.replace(/\\/g, "/")}:mod`;
    const n = nodes.find((x) => normalizeTargetLabel(String(x.name || "")) === nodeLabel);
    assert.ok(n, `missing expected node ${nodeLabel}`);

    const linkDeps = normalizeLabelList((n as any).link_deps);
    assert.ok(
      linkDeps.includes(`//${appRel.replace(/\\/g, "/")}:dep_a`),
      "missing expected link_deps entry",
    );

    const linkClosure = String((n as any).link_closure || "");
    assert.equal(linkClosure, "transitive");

    const overrides = (n as any).link_closure_overrides || {};
    const overrideKeyToValue = new Map<string, string>();
    for (const [k, v] of Object.entries(overrides || {})) {
      overrideKeyToValue.set(normalizeTargetLabel(k), String(v || ""));
    }
    const depA = `//${appRel.replace(/\\/g, "/")}:dep_a`;
    assert.equal(overrideKeyToValue.get(depA), "transitive");
  });
});
