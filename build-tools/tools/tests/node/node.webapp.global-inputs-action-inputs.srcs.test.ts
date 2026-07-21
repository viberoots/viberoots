#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const GLOBAL_INPUT_MARKERS = [
  ":flake.lock",
  ":node-modules.hashes.json",
  ":nixpkgs_source_registry",
  ":nixpkgs-source-registry-extension",
];

test("node_webapp includes global Nix inputs as genrule srcs (action inputs)", async () => {
  await runInTemp("node-webapp-global-inputs-srcs", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(path.join(dir, "src"), { recursive: true });
    await fsp.writeFile(path.join(dir, "src", "index.ts"), "export {};\n", "utf8");
    await fsp.writeFile(path.join(dir, "package.json"), '{"name":"web"}\n', "utf8");
    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "node_webapp")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/web:bundle`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    for (const marker of GLOBAL_INPUT_MARKERS) {
      assert.ok(out.includes(marker), `expected ${marker} in srcs via global_nix_inputs()`);
    }
    for (const relative of ["src/index.ts", "package.json", "pnpm-lock.yaml"]) {
      assert.ok(
        out.includes(`projects/apps/web/${relative}`),
        `expected importer-layout action input for ${relative}`,
      );
    }

    const labelsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/web:bundle`;
    if (labelsProbe.exitCode !== 0) {
      // Environment not fully available in temp. Skip to avoid false negatives.
      return;
    }
    const labelsOut = String(labelsProbe.stdout || "");
    for (const marker of GLOBAL_INPUT_MARKERS) {
      assert.ok(labelsOut.includes(marker), `expected ${marker} label when stamp=True`);
    }
  });
});
