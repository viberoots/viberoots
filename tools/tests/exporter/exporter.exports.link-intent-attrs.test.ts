#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { normalizeTargetLabel } from "../../lib/labels";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

test("exporter exports link intent attrs when present on a target", async () => {
  await runInTemp("exporter-link-intent-attrs", async (tmp, $) => {
    const pkgRel = path.join("cpp", "probe_link_intent_attrs");
    const pkg = path.join(tmp, pkgRel);
    await fs.mkdirp(pkg);

    await fs.outputFile(
      path.join(pkg, "defs.bzl"),
      [
        "def _impl(ctx):",
        "    out = ctx.actions.declare_output(ctx.attrs.out)",
        '    ctx.actions.write(out, "ok\\n")',
        "    return [DefaultInfo(default_output = out)]",
        "",
        "link_intent_attrs = rule(",
        "    impl = _impl,",
        "    attrs = {",
        '        "deps": attrs.list(attrs.dep(), default = []),',
        '        "out": attrs.string(default = "ok.txt"),',
        '        "link_deps": attrs.list(attrs.dep(), default = []),',
        '        "header_deps": attrs.list(attrs.dep(), default = []),',
        '        "link_closure": attrs.string(default = "direct"),',
        '        "link_closure_overrides": attrs.dict(attrs.label(), attrs.string(), default = {}),',
        "    },",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(pkg, "TARGETS"),
      [
        'load(":defs.bzl", "link_intent_attrs")',
        "",
        "filegroup(",
        '    name = "dep_a",',
        "    srcs = [],",
        ")",
        "",
        "filegroup(",
        '    name = "dep_b",',
        "    srcs = [],",
        ")",
        "",
        "link_intent_attrs(",
        '    name = "t",',
        "    link_deps = [",
        '        ":dep_a",',
        "    ],",
        "    header_deps = [",
        '        ":dep_b",',
        "    ],",
        '    link_closure = "transitive",',
        "    link_closure_overrides = {",
        '        ":dep_a": "transitive",',
        "    },",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const graphPath = path.join(tmp, "tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graphPath));

    const res = await $({ cwd: tmp, stdio: "pipe" })`tools/buck/export-graph.ts --out ${graphPath}`;
    if (res.exitCode !== 0) {
      console.error("exporter failed:", String(res.stderr || ""));
      process.exit(2);
    }

    const nodes = await readGraph(graphPath);
    const want = `//${pkgRel.replace(/\\/g, "/")}:t`;
    const n = nodes.find((x) => normalizeTargetLabel(String(x.name || "")) === want);
    if (!n) {
      console.error(`missing expected node ${want}`);
      process.exit(2);
    }

    const linkDepsRaw = Array.isArray((n as any).link_deps)
      ? ((n as any).link_deps as string[])
      : [];
    const headerDepsRaw = Array.isArray((n as any).header_deps)
      ? ((n as any).header_deps as string[])
      : [];
    const linkDeps = linkDepsRaw.map(normalizeTargetLabel);
    const headerDeps = headerDepsRaw.map(normalizeTargetLabel);
    const linkClosure = String((n as any).link_closure || "");
    const overrides = (n as any).link_closure_overrides || {};
    const overrideKeyToValue = new Map<string, string>();
    for (const [k, v] of Object.entries(overrides || {})) {
      overrideKeyToValue.set(normalizeTargetLabel(k), String(v || ""));
    }

    const depA = `//${pkgRel.replace(/\\/g, "/")}:dep_a`;
    const depB = `//${pkgRel.replace(/\\/g, "/")}:dep_b`;
    if (!linkDeps.includes(depA)) {
      console.error("missing expected link_deps entry", linkDepsRaw);
      process.exit(2);
    }
    if (!headerDeps.includes(depB)) {
      console.error("missing expected header_deps entry", headerDepsRaw);
      process.exit(2);
    }
    if (linkClosure !== "transitive") {
      console.error("unexpected link_closure", linkClosure);
      process.exit(2);
    }
    if (!overrideKeyToValue.has(depA)) {
      console.error("missing expected override key", Array.from(overrideKeyToValue.keys()));
      process.exit(2);
    }
    if (overrideKeyToValue.get(depA) !== "transitive") {
      console.error("unexpected override value", Object.fromEntries(overrideKeyToValue.entries()));
      process.exit(2);
    }
  });
});
