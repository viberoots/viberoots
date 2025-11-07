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

    // TARGETS with two genrules, each labeled to its importer lockfile and including importer-local patches in srcs
    const targets = [
      "",
      'load("@prelude//:rules.bzl", "genrule")',
      'genrule(name="ta", out="a.stamp", cmd="echo a > $OUT", srcs = glob(["apps/a/patches/node/*.patch"]), labels=["lockfile:apps/a/pnpm-lock.yaml#apps/a"])',
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
    const a1 = await fsp.stat(path.isAbsolute(pathA) ? pathA : path.join(tmp, pathA));
    const b1 = await fsp.stat(path.isAbsolute(pathB) ? pathB : path.join(tmp, pathB));

    // Add importer-local patch only for importer A
    const patchDirA = path.join(tmp, "apps/a/patches/node");
    await fsp.mkdir(patchDirA, { recursive: true });
    await fsp.writeFile(path.join(patchDirA, "leftpad@1.3.0.patch"), "# noop\n", "utf8");

    // Rebuild both targets
    await $`buck2 build --target-platforms //:no_cgo //:ta //:tb`;
    const a2 = await fsp.stat(path.isAbsolute(pathA) ? pathA : path.join(tmp, pathA));
    const b2 = await fsp.stat(path.isAbsolute(pathB) ? pathB : path.join(tmp, pathB));

    if (!(a2.mtimeMs > a1.mtimeMs)) {
      console.error("expected //:ta to rebuild after importer A patch (mtime not increased)");
      console.error("before:", a1.mtimeMs, "after:", a2.mtimeMs);
      process.exit(2);
    }
    if (!(b2.mtimeMs === b1.mtimeMs)) {
      console.error("expected //:tb to remain a cache hit (mtime changed unexpectedly)");
      console.error("before:", b1.mtimeMs, "after:", b2.mtimeMs);
      process.exit(2);
    }
  });
});
