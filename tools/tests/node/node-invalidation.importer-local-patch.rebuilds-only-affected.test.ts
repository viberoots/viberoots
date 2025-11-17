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

    // TARGETS with two genrules, each labeled to its importer lockfile and including importer-local patches in srcs
    const targets = [
      "",
      'load("@prelude//:rules.bzl", "genrule")',
      // Write a different timestamp on rebuild so mtime/content changes are observable for target A
      'genrule(name="ta", out="a.stamp", cmd="date +%s > $OUT", srcs = glob(["apps/a/patches/node/*.patch"]), labels=["lockfile:apps/a/pnpm-lock.yaml#apps/a"])',
      'genrule(name="tb", out="b.stamp", cmd="echo b > $OUT", srcs = glob(["apps/b/patches/node/*.patch"]), labels=["lockfile:apps/b/pnpm-lock.yaml#apps/b"])',
      "",
    ].join("\n");
    await fsp.appendFile(path.join(tmp, "TARGETS"), targets, "utf8");

    // Initial build
    await $`buck2 build --target-platforms //:no_cgo //:ta //:tb`;
    const outA1 = await $`buck2 targets --target-platforms //:no_cgo --show-output //:ta`;
    const outB1 = await $`buck2 targets --target-platforms //:no_cgo --show-output //:tb`;
    const pathA =
      String(outA1.stdout || "")
        .trim()
        .split(/\s+/)
        .pop() || "";
    const pathB =
      String(outB1.stdout || "")
        .trim()
        .split(/\s+/)
        .pop() || "";
    if (!pathA || !pathB) {
      console.error("could not determine genrule output paths");
      process.exit(2);
    }
    const aPathAbs = path.isAbsolute(pathA) ? pathA : path.join(tmp, pathA);
    const bPathAbs = path.isAbsolute(pathB) ? pathB : path.join(tmp, pathB);
    const a1Content = await fsp.readFile(aPathAbs, "utf8").catch(() => "");
    const b1Content = await fsp.readFile(bPathAbs, "utf8").catch(() => "");

    // Add importer-local patch only for importer A
    await fsp.writeFile(path.join(patchDirA, "leftpad@1.3.0.patch"), "# noop\n", "utf8");

    // Rebuild both targets (ensure daemon refresh so glob picks up newly created files)
    await $`buck2 kill`.nothrow();
    await $`buck2 build --target-platforms //:no_cgo //:ta //:tb`;
    const a2Content = await fsp.readFile(aPathAbs, "utf8").catch(() => "");
    const b2Content = await fsp.readFile(bPathAbs, "utf8").catch(() => "");

    if (!(a2Content !== a1Content)) {
      console.error("expected //:ta content to change after importer A patch");
      console.error("before:", JSON.stringify(a1Content), "after:", JSON.stringify(a2Content));
      process.exit(2);
    }
    if (!(b2Content === b1Content)) {
      console.error("expected //:tb content to remain unchanged");
      console.error("before:", JSON.stringify(b1Content), "after:", JSON.stringify(b2Content));
      process.exit(2);
    }
  });
});
