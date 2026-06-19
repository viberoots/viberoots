#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { computeImporterLabel } from "../../lib/importers";
import { runInTemp } from "../lib/test-helpers";

test("Starlark importer_from_labels ↔ TS computeImporterLabel parity", async () => {
  await runInTemp("importer-label-parity", async (tmp, $) => {
    // Synthesize representative lockfiles and a probe macro that extracts importer in Starlark
    const targetsPath = path.join(tmp, "TARGETS");
    await fsp.appendFile(
      targetsPath,
      [
        'load("@viberoots//build-tools/lang:defs_common.bzl", "importer_from_labels_probe")',
        "",
      ].join("\n"),
      "utf8",
    );

    type Case = { lf: string; label: string };
    const cases: Case[] = [
      { lf: "pnpm-lock.yaml", label: "lockfile:pnpm-lock.yaml#." },
      {
        lf: "projects/apps/web/pnpm-lock.yaml",
        label: "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
      },
      { lf: "uv.lock", label: "lockfile:uv.lock#." },
      {
        lf: "projects/apps/api/uv.lock",
        label: "lockfile:projects/apps/api/uv.lock#projects/apps/api",
      },
    ];
    // Ensure directories and files exist for realism
    await fsp.mkdir(path.join(tmp, "projects", "apps", "web"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "projects", "apps", "api"), { recursive: true });
    for (const c of cases) {
      const p = path.join(tmp, c.lf);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, "# lockfile\n", "utf8");
    }
    // Define probes in TARGETS
    const body = cases
      .map((c, i) =>
        [`importer_from_labels_probe(name = "probe_${i}", lockfile_label = "${c.label}")`, ""].join(
          "\n",
        ),
      )
      .join("\n");
    await fsp.appendFile(targetsPath, body, "utf8");

    // Build all probes and read materialized importer outputs
    const outTxt = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo --show-output //:probe_0 //:probe_1 //:probe_2 //:probe_3`;
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
      const starlarkImp = (await fsp.readFile(path.join(tmp, outFile!), "utf8")).trim();
      const tsImp = computeImporterLabel(cases[i].lf);
      assert.equal(
        starlarkImp,
        tsImp,
        `Mismatch for ${cases[i].lf}: Starlark=${starlarkImp} TS=${tsImp}`,
      );
    }
  });
});
