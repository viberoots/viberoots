#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node: importer-local patch touch triggers rebuild of target", async () => {
  await runInTemp("node-invalidation-patch-touch", async (tmp, $) => {
    await $`git init`;

    // Minimal PNPM lockfile with one importer
    const lf = path.join(tmp, "apps/demo/pnpm-lock.yaml");
    await fsp.mkdir(path.dirname(lf), { recursive: true });
    await fsp.writeFile(lf, `lockfileVersion: "9.0"\nimporters:\n  apps/demo: {}\n`, "utf8");
    // Ensure the importer-local patches directory exists before the initial build so glob()
    // tracks it and future patch additions invalidate correctly
    const patchDir = path.join(tmp, "apps/demo/patches/node");
    await fsp.mkdir(patchDir, { recursive: true });
    // Seed a baseline patch so glob() tracks the file from the start
    const basePatch = path.join(patchDir, "base@0.0.0.patch");
    await fsp.writeFile(basePatch, "# baseline\n", "utf8");

    // TARGETS with nix_node_gen requiring the importer-scoped lockfile label
    const targets = [
      "",
      'load("@prelude//:rules.bzl", "genrule")',
      // Simulate macro behavior: include importer-local patches in srcs and carry the lockfile label
      // Make output content depend on the sources so we can assert a deterministic change (robust vs mtime)
      "genrule(",
      '  name = "t",',
      '  out = "out.stamp",',
      "  cmd = \"bash -c 'set -euo pipefail; cat $SRCDIR/apps/demo/patches/node/*.patch | wc -c > $OUT'\",",
      '  srcs = glob(["apps/demo/patches/node/*.patch"]),',
      '  labels = ["lockfile:apps/demo/pnpm-lock.yaml#apps/demo"],',
      ")",
      "",
    ].join("\n");
    // Append to the existing TARGETS created by test harness to preserve platform config
    await fsp.appendFile(path.join(tmp, "TARGETS"), targets, "utf8");

    // Initial build
    await $`buck2 build --target-platforms //:no_cgo //:t`;
    const so1 = await $`buck2 targets --target-platforms //:no_cgo --show-output //:t`;
    const line =
      String(so1.stdout || "")
        .trim()
        .split(/\r?\n/)
        .find((l) => l.includes("//:t")) || "";
    const outPath = line.split(/\s+/)[1];
    if (!outPath) {
      console.error("could not determine genrule output path from --show-output");
      process.exit(2);
    }
    const outAbs = path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
    const c1 = await fsp.readFile(outAbs, "utf8").then((s) => s.trim());

    // Modify the existing importer-local patch and rebuild
    await fsp.appendFile(basePatch, "# change\n", "utf8");
    // Ensure daemon sees new/changed sources deterministically
    await $`buck2 kill`.nothrow();

    await $`buck2 build --target-platforms //:no_cgo //:t`;
    const c2 = await fsp.readFile(outAbs, "utf8").then((s) => s.trim());
    if (c1 === c2) {
      console.error("expected target output to change after importer-local patch change");
      console.error("before-content:", JSON.stringify(c1), "after-content:", JSON.stringify(c2));
      process.exit(2);
    }
  });
});
