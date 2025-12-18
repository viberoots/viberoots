#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { isSupportedImporterLabel } from "../../lib/importers";
import { parseLockfileLabel } from "../../lib/labels";

type ProbeOut = { lockfile: string; importer: string };

async function buckBuildProbe(tmp: string, $: any, target: string) {
  return await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`buck2 build ${target} --show-output --target-platforms //:no_cgo`;
}

test("lockfile label parsing parity (TS ↔ Starlark): strict '#', ./ normalization, importer-dir rule", async () => {
  await runInTemp("lockfile-label-parity", async (tmp, $) => {
    const targetsPath = path.join(tmp, "TARGETS");
    await fsp.appendFile(
      targetsPath,
      ['load("//lang:defs_common.bzl", "lockfile_label_parse_probe")', ""].join("\n"),
      "utf8",
    );

    const cases = [
      { label: "lockfile:pnpm-lock.yaml#." },
      { label: "lockfile:apps/web/pnpm-lock.yaml#apps/web" },
      { label: "lockfile:./apps/web/pnpm-lock.yaml#apps/web" }, // normalization
      { label: "lockfile:././apps/web/pnpm-lock.yaml#apps/web" }, // repeated normalization
      { label: "lockfile:services/api/pnpm-lock.yaml#services/api" }, // syntactically valid in TS; rejected by Starlark (unsupported importer)
      { label: "lockfile:apps/web/pnpm-lock.yaml#." }, // invalid: '#.' only allowed for repo-root lockfiles
      { label: "lockfile:uv.lock#." },
      { label: "lockfile:apps/api/uv.lock#apps/api" },
      // Invalid shapes
      { label: "lockfile:apps/web/pnpm-lock.yaml" }, // missing '#<importer>'
      { label: "lockfile:apps/web/pnpm-lock.yaml#" }, // empty importer
      { label: "lockfile:#apps/web" }, // empty path
      { label: "lockfile:apps/web/pnpm-lock.yaml#apps/web#extra" }, // extra '#'
      { label: "lockfile:apps/web/pnpm-lock.yaml#apps/api" }, // importer mismatch
    ] as const;

    // Ensure directories exist for realism (Buck doesn't require contents, but this mirrors real layout).
    await fsp.mkdir(path.join(tmp, "apps", "web"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "apps", "api"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "services", "api"), { recursive: true });

    const body = cases
      .map((c, i) =>
        [`lockfile_label_parse_probe(name = "probe_${i}", lockfile_label = "${c.label}")`, ""].join(
          "\n",
        ),
      )
      .join("\n");
    await fsp.appendFile(targetsPath, body, "utf8");

    for (let i = 0; i < cases.length; i++) {
      const label = cases[i].label;
      const ts = parseLockfileLabel(label);
      const target = `//:probe_${i}`;

      const res = await buckBuildProbe(tmp, $, target);
      if (!ts) {
        assert.notEqual(
          res.exitCode,
          0,
          `expected buck2 build to fail for invalid label: ${label}`,
        );
        continue;
      }

      if (!isSupportedImporterLabel(ts.importer)) {
        assert.notEqual(
          res.exitCode,
          0,
          `expected buck2 build to fail for unsupported importer label: ${label}`,
        );
        const combined = String(res.stderr || "") + String(res.stdout || "");
        assert.ok(
          combined.includes("Unsupported importer label in lockfile label"),
          `expected unsupported-importer error text; got:\n${combined}`,
        );
        assert.ok(
          combined.includes("apps/*") && combined.includes("libs/*"),
          `expected supported importer roots to be mentioned; got:\n${combined}`,
        );
        continue;
      }

      assert.equal(
        res.exitCode,
        0,
        `expected buck2 build to succeed for valid label: ${label}\n${res.stderr}`,
      );

      // Parse "--show-output" line: "<target> <path>"
      const lines = String(res.stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean);
      assert.ok(lines.length >= 1, `expected output line for ${target}`);
      const outPath = lines[lines.length - 1].trim().split(/\s+/).pop();
      assert.ok(outPath, `expected output path for ${target}`);

      const txt = await fsp.readFile(path.join(tmp, outPath!), "utf8");
      const got = JSON.parse(txt) as ProbeOut;
      assert.deepEqual(
        got,
        { lockfile: ts.lockfile, importer: ts.importer },
        `Starlark parse mismatch for ${label}`,
      );
    }
  });
});
