#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { getImporterRootsContract } from "../../lib/importer-roots";
import { isSupportedImporterLabel } from "../../lib/importers";
import { runInTemp } from "../lib/test-helpers";

type ProbeOut = { importer: string; supported: boolean };

test("Starlark supported importer predicate ↔ TS isSupportedImporterLabel parity", async () => {
  await runInTemp("supported-importer-parity", async (tmp, $) => {
    const targetsPath = path.join(tmp, "TARGETS");
    await fsp.appendFile(
      targetsPath,
      [
        'load("@viberoots//build-tools/lang:defs_common.bzl", "supported_importer_label_probe")',
        "",
      ].join("\n"),
      "utf8",
    );

    const { allowDotImporter, workspaceRoots } = getImporterRootsContract();
    const supported: string[] = [];
    if (allowDotImporter) supported.push(".");
    for (const r of workspaceRoots) supported.push(`${r}/foo`);
    const unsupported: string[] = ["build-tools/tools/x", "../projects/apps/x"];
    for (const r of workspaceRoots) unsupported.push(`${r}/foo/bar`);
    const cases = [...supported, ...unsupported];
    const body = cases
      .map((imp, i) =>
        [`supported_importer_label_probe(name = "probe_${i}", importer = "${imp}")`, ""].join("\n"),
      )
      .join("\n");
    await fsp.appendFile(targetsPath, body, "utf8");

    const targets = cases.map((_, i) => `//:probe_${i}`);
    const outTxt = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo --show-output ${targets}`;

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
      const importer = cases[i];
      const t = `root//:probe_${i}`;
      const outFile = outputs.get(t);
      assert.ok(outFile, `expected output for ${t}`);

      const txt = await fsp.readFile(path.join(tmp, outFile!), "utf8");
      const st = JSON.parse(txt) as ProbeOut;
      assert.equal(st.importer, importer);

      const ts = isSupportedImporterLabel(importer);
      assert.equal(st.supported, ts, `Mismatch for importer=${importer}`);
    }
  });
});
