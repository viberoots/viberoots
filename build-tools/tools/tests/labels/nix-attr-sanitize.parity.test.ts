#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { sanitizeAttrNameFromLabel } from "../../lib/labels";
import { runInTemp } from "../lib/test-helpers";

test("Starlark sanitize_nix_attr_from_target_label ↔ TS sanitizeAttrNameFromLabel parity", async () => {
  await runInTemp("nix-attr-sanitize-parity", async (tmp, $) => {
    const targetsPath = path.join(tmp, "TARGETS");
    await fsp.appendFile(
      targetsPath,
      [
        'load("//build-tools/lang:nix_attr.bzl", "sanitize_nix_attr_from_target_label_probe")',
        "",
      ].join("\n"),
      "utf8",
    );

    const cases: string[] = [
      "root//apps/foo:svc (config//toolchains:default#buck2/default//:default#linkerbuild-tools/lang/cxx)",
      "prelude//build-tools/cpp:lib (config//toolchains:xyz)",
      "//apps/foo:my bin",
      "root//apps/foo:my@target",
      "apps/foo:svc (config//buck:some)",
      "root//third_party/providers:prov (root//:no_cgo#6eb543497f051f11)",
      "//a:b/c",
      "//UPPER:Case With Spaces",
    ];

    const probeDecls = cases
      .map(
        (label, i) =>
          `sanitize_nix_attr_from_target_label_probe(name = "probe_${i}", label = ${JSON.stringify(label)})`,
      )
      .join("\n\n");
    await fsp.appendFile(targetsPath, probeDecls + "\n", "utf8");

    const probeTargets = cases.map((_, i) => `//:probe_${i}`);
    const outTxt = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo --show-output ${probeTargets}`;
    if (outTxt.exitCode !== 0) return;

    const lines = String(outTxt.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean);
    const outputs = new Map<string, string>();
    for (const line of lines) {
      const idx = line.indexOf(" ");
      if (idx > 0) {
        const target = line.slice(0, idx).trim();
        const outPath = line.slice(idx + 1).trim();
        if (target && outPath) outputs.set(target, outPath);
      }
    }

    for (let i = 0; i < cases.length; i++) {
      const t = `root//:probe_${i}`;
      const outFile = outputs.get(t);
      assert.ok(outFile, `expected output for ${t}`);
      const starlark = (await fsp.readFile(path.join(tmp, outFile!), "utf8")).trim();
      const ts = sanitizeAttrNameFromLabel(cases[i]);
      assert.equal(starlark, ts, `Mismatch for ${cases[i]}: Starlark=${starlark} TS=${ts}`);
    }
  });
});
