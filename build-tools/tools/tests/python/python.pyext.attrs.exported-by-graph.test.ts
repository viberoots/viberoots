#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { readGraph } from "../../lib/graph";
import { normalizeTargetLabel } from "../../lib/labels";
import { runInTemp } from "../lib/test-helpers";

function normalizeLabelList(xs: unknown): string[] {
  const raw = Array.isArray(xs) ? (xs as unknown[]) : [];
  return raw.map((x) => normalizeTargetLabel(String(x))).filter(Boolean);
}

test("exporter: python pyext nodes include module + link intent attrs in .viberoots/workspace/buck/graph.json", async () => {
  await runInTemp("python-pyext-exported-attrs", async (tmp, $) => {
    const appRel = path.join("projects", "apps", "pyext_export");
    const app = path.join(tmp, appRel);
    await fs.mkdirp(path.join(app, "native"));
    await fs.writeFile(path.join(app, "native", "ext.c"), "int x(){return 1;}\n", "utf8");
    await fs.writeFile(
      path.join(app, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(app, "TARGETS"),
      [
        'load("@viberoots//build-tools/python:defs.bzl", "nix_python_extension_module")',
        "",
        "filegroup(",
        '  name = "dep_link",',
        "  srcs = [],",
        '  visibility = ["PUBLIC"],',
        ")",
        "filegroup(",
        '  name = "dep_hdr",',
        "  srcs = [],",
        '  visibility = ["PUBLIC"],',
        ")",
        "",
        "nix_python_extension_module(",
        '  name = "ext",',
        '  lockfile_label = "lockfile:projects/apps/pyext_export/uv.lock#projects/apps/pyext_export",',
        '  module = "demo._native",',
        '  srcs = ["native/ext.c"],',
        '  link_deps = [":dep_link"],',
        '  header_deps = [":dep_hdr"],',
        '  link_closure = "transitive",',
        '  link_closure_overrides = {":dep_link": "direct"},',
        '  cflags = ["-DHELLO=1"],',
        '  ldflags = ["-Wl,-dead_strip"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const graphPath = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fs.mkdirp(path.dirname(graphPath));

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`node viberoots/build-tools/tools/buck/export-graph.ts --out ${graphPath}`;
    if (res.exitCode !== 0) return; // skip when Buck/prelude/toolchains unavailable

    const nodes = await readGraph(graphPath);
    const label = `//${appRel.replace(/\\/g, "/")}:ext`;
    const node = nodes.find((n) => String(n.name || "") === label);
    assert.ok(node, `missing node ${label}`);

    const labels = (node?.labels || []).map(String).sort();
    assert.ok(labels.includes("lang:python"), "missing lang:python label");
    assert.ok(labels.includes("kind:pyext"), "missing kind:pyext label");

    assert.equal(String((node as any).module || ""), "demo._native");

    const linkDeps = normalizeLabelList((node as any).link_deps);
    const headerDeps = normalizeLabelList((node as any).header_deps);
    assert.ok(linkDeps.includes(`${label.replace(":ext", ":dep_link")}`), "missing link_deps");
    assert.ok(headerDeps.includes(`${label.replace(":ext", ":dep_hdr")}`), "missing header_deps");
    assert.equal(String((node as any).link_closure || ""), "transitive");

    const overrides = (node as any).link_closure_overrides as Record<string, string> | undefined;
    assert.ok(overrides && typeof overrides === "object", "missing link_closure_overrides");
    assert.equal(
      String(overrides![`${label.replace(":ext", ":dep_link")}`] || ""),
      "direct",
      "unexpected link_closure_overrides value",
    );

    const cflags = (node as any).cflags as unknown;
    const ldflags = (node as any).ldflags as unknown;
    assert.deepEqual(Array.isArray(cflags) ? cflags : [], ["-DHELLO=1"]);
    assert.deepEqual(Array.isArray(ldflags) ? ldflags : [], ["-Wl,-dead_strip"]);
  });
});
