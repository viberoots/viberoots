#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node: importer-local patch rebuilds only affected importer's target", async () => {
  await runInTemp("node-invalidation-only-affected", async (tmp, $) => {
    await $`git init`;

    // Two importers with their own lockfiles
    const lfA = path.join(tmp, "apps/a/pnpm-lock.yaml");
    const lfB = path.join(tmp, "apps/b/pnpm-lock.yaml");
    await fsp.mkdir(path.dirname(lfA), { recursive: true });
    await fsp.mkdir(path.dirname(lfB), { recursive: true });
    await fsp.writeFile(lfA, `lockfileVersion: "9.0"\nimporters:\n  apps/a: {}\n`, "utf8");
    await fsp.writeFile(lfB, `lockfileVersion: "9.0"\nimporters:\n  apps/b: {}\n`, "utf8");
    // Ensure importer-local patches directories exist before the initial build so glob() tracks them
    const patchDirA = path.join(tmp, "apps/a/patches/node");
    const patchDirB = path.join(tmp, "apps/b/patches/node");
    await fsp.mkdir(patchDirA, { recursive: true });
    await fsp.mkdir(patchDirB, { recursive: true });
    // Seed a baseline patch for A so the rule has a declared input we can track
    await fsp.writeFile(path.join(patchDirA, "base@0.0.0.patch"), "# baseline\n", "utf8");

    // Create per-package TARGETS so globs resolve relative to the importer package
    const targetsA = [
      'load("@prelude//:rules.bzl", "genrule", "export_file")',
      'export_file(name = "pa", src = "patches/node/base@0.0.0.patch")',
      "genrule(",
      '  name = "ta",',
      '  out = "a.stamp",',
      "  cmd = \"bash -c 'set -euo pipefail; wc -c < $(location :pa) > $OUT'\",",
      '  srcs = [":pa"],',
      '  labels = ["lockfile:apps/a/pnpm-lock.yaml#apps/a"],',
      ")",
      "",
    ].join("\n");
    await fsp.writeFile(path.join(tmp, "apps/a/TARGETS"), targetsA, "utf8");
    const targetsB = [
      'load("@prelude//:rules.bzl", "genrule")',
      'genrule(name="tb", out="b.stamp", cmd="echo b > $OUT", srcs = glob(["patches/node/*.patch"]), labels=["lockfile:apps/b/pnpm-lock.yaml#apps/b"])',
      "",
    ].join("\n");
    await fsp.writeFile(path.join(tmp, "apps/b/TARGETS"), targetsB, "utf8");

    // Initial build
    await $`buck2 build --target-platforms //:no_cgo //apps/a:ta //apps/b:tb`;
    const outA1 = await $`buck2 targets --target-platforms //:no_cgo --show-output //apps/a:ta`;
    const outB1 = await $`buck2 targets --target-platforms //:no_cgo --show-output //apps/b:tb`;
    const lineA1 =
      String(outA1.stdout || "")
        .trim()
        .split(/\r?\n/)
        .find((l) => l.includes("apps/a:ta")) ||
      String(outA1.stdout || "")
        .trim()
        .split(/\r?\n/)[0] ||
      "";
    const lineB1 =
      String(outB1.stdout || "")
        .trim()
        .split(/\r?\n/)
        .find((l) => l.includes("apps/b:tb")) ||
      String(outB1.stdout || "")
        .trim()
        .split(/\r?\n/)[0] ||
      "";
    const pathA1 = (lineA1.split(/\s+/)[1] || "").trim();
    const pathB1 = (lineB1.split(/\s+/)[1] || "").trim();
    if (!pathA1 || !pathB1) {
      console.error("could not determine initial genrule output paths");
      process.exit(2);
    }
    const aAbs = path.isAbsolute(pathA1) ? pathA1 : path.join(tmp, pathA1);
    const bAbs = path.isAbsolute(pathB1) ? pathB1 : path.join(tmp, pathB1);
    const a1Content = await fsp
      .readFile(aAbs, "utf8")
      .then((s) => s.trim())
      .catch(() => "");
    const b1Content = await fsp
      .readFile(bAbs, "utf8")
      .then((s) => s.trim())
      .catch(() => "");

    // Change importer-local patch only for importer A (modify the declared input)
    await fsp.appendFile(path.join(patchDirA, "base@0.0.0.patch"), "# change\n", "utf8");

    // Rebuild both targets (ensure daemon refresh so glob picks up newly created files)
    await $`buck2 kill`.nothrow();
    await $`buck2 build --target-platforms //:no_cgo //apps/a:ta //apps/b:tb`;
    const outA2 = await $`buck2 targets --target-platforms //:no_cgo --show-output //apps/a:ta`;
    const outB2 = await $`buck2 targets --target-platforms //:no_cgo --show-output //apps/b:tb`;
    const lineA2 =
      String(outA2.stdout || "")
        .trim()
        .split(/\r?\n/)
        .find((l) => l.includes("apps/a:ta")) ||
      String(outA2.stdout || "")
        .trim()
        .split(/\r?\n/)[0] ||
      "";
    const lineB2 =
      String(outB2.stdout || "")
        .trim()
        .split(/\r?\n/)
        .find((l) => l.includes("apps/b:tb")) ||
      String(outB2.stdout || "")
        .trim()
        .split(/\r?\n/)[0] ||
      "";
    const pathA2 = (lineA2.split(/\s+/)[1] || "").trim();
    const pathB2 = (lineB2.split(/\s+/)[1] || "").trim();
    if (!pathA2 || !pathB2) {
      console.error("could not determine second genrule output paths");
      process.exit(2);
    }
    const a2Content = await fsp
      .readFile(path.isAbsolute(pathA2) ? pathA2 : path.join(tmp, pathA2), "utf8")
      .then((s) => s.trim())
      .catch(() => "");
    const b2Content = await fsp
      .readFile(path.isAbsolute(pathB2) ? pathB2 : path.join(tmp, pathB2), "utf8")
      .then((s) => s.trim())
      .catch(() => "");
    if (!(a2Content !== a1Content)) {
      console.error("expected //apps/a:ta content to change after importer A patch");
      console.error("before:", JSON.stringify(a1Content), "after:", JSON.stringify(a2Content));
      process.exit(2);
    }
    if (!(b2Content === b1Content)) {
      console.error("expected //apps/b:tb content to remain unchanged");
      console.error("before:", JSON.stringify(b1Content), "after:", JSON.stringify(b2Content));
      process.exit(2);
    }
  });
});
