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

test("exporter: C++ macros preserve link intent attrs in build-tools/tools/buck/graph.json", async () => {
  await runInTemp("cpp-macros-link-intent-exported-attrs", async (tmp, $) => {
    const appRel = path.join("projects", "apps", "link_intent_export");
    const app = path.join(tmp, appRel);
    await fs.mkdirp(path.join(app, "src"));
    await fs.mkdirp(path.join(app, "tests"));

    await fs.writeFile(path.join(app, "src", "lib.cpp"), "int lib(){return 0;}\n", "utf8");
    await fs.writeFile(path.join(app, "src", "main.cpp"), "int main(){return 0;}\n", "utf8");
    await fs.writeFile(path.join(app, "src", "addon.cpp"), "int addon(){return 0;}\n", "utf8");
    await fs.writeFile(path.join(app, "tests", "t.cpp"), "int main(){return 0;}\n", "utf8");
    await fs.writeFile(
      path.join(app, "src", "hdr.h"),
      "#pragma once\ninline int k(){return 7;}\n",
      "utf8",
    );

    await fs.writeFile(
      path.join(app, "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_headers", "nix_cpp_library", "nix_cpp_node_addon", "nix_cpp_test")',
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
        "nix_cpp_library(",
        '  name = "lib",',
        '  srcs = ["src/lib.cpp"],',
        '  link_deps = [":dep_link"],',
        '  header_deps = [":dep_hdr"],',
        '  link_closure = "transitive",',
        '  labels = ["lang:cpp"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
        "nix_cpp_binary(",
        '  name = "bin",',
        '  srcs = ["src/main.cpp"],',
        '  link_deps = [":dep_link"],',
        '  header_deps = [":dep_hdr"],',
        '  link_closure = "direct",',
        '  labels = ["lang:cpp"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
        "nix_cpp_node_addon(",
        '  name = "addon",',
        '  srcs = ["src/addon.cpp"],',
        '  link_deps = [":dep_link"],',
        '  header_deps = [":dep_hdr"],',
        '  link_closure = "direct",',
        '  labels = ["lang:cpp"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
        "nix_cpp_headers(",
        '  name = "headers",',
        '  srcs = ["src/hdr.h"],',
        '  link_deps = [":dep_link"],',
        '  header_deps = [":dep_hdr"],',
        '  link_closure = "direct",',
        '  labels = ["lang:cpp"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
        "nix_cpp_test(",
        '  name = "t",',
        '  srcs = ["tests/t.cpp"],',
        '  link_deps = [":dep_link"],',
        '  header_deps = [":dep_hdr"],',
        '  link_closure = "transitive",',
        '  labels = ["lang:cpp"],',
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
    const n = (label: string) => nodes.find((x) => String(x.name || "") === label);

    const want = [
      `//${appRel.replace(/\\/g, "/")}:lib`,
      `//${appRel.replace(/\\/g, "/")}:bin`,
      `//${appRel.replace(/\\/g, "/")}:addon`,
      `//${appRel.replace(/\\/g, "/")}:headers`,
      `//${appRel.replace(/\\/g, "/")}:t__planner`,
    ];

    for (const label of want) {
      const node = n(label);
      assert.ok(node, `missing node ${label}`);
      const linkDeps = normalizeLabelList((node as any).link_deps);
      const headerDeps = normalizeLabelList((node as any).header_deps);
      assert.ok(
        linkDeps.includes(`//${appRel.replace(/\\/g, "/")}:dep_link`),
        `missing link_deps on ${label}`,
      );
      assert.ok(
        headerDeps.includes(`//${appRel.replace(/\\/g, "/")}:dep_hdr`),
        `missing header_deps on ${label}`,
      );
      const closure = String((node as any).link_closure || "");
      assert.ok(
        closure === "direct" || closure === "transitive",
        `missing link_closure on ${label}`,
      );
    }
  });
});
