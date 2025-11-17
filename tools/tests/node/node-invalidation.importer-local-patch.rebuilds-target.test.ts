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

    // TARGETS with nix_node_gen requiring the importer-scoped lockfile label
    const targets = [
      "",
      'load("@prelude//:rules.bzl", "genrule")',
      // Simulate macro behavior: include importer-local patches in srcs and carry the lockfile label
      'genrule(name="t", out="out.stamp", cmd="echo ok > $OUT", srcs = glob(["apps/demo/patches/node/*.patch"]), labels=["lockfile:apps/demo/pnpm-lock.yaml#apps/demo"])',
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
    const s1 = await fsp.stat(path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath));

    // Add importer-local patch and rebuild
    await fsp.writeFile(path.join(patchDir, "lodash@4.17.21.patch"), "# noop\n", "utf8");

    await $`buck2 build --target-platforms //:no_cgo //:t`;
    const s2 = await fsp.stat(path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath));
    if (!(s2.mtimeMs > s1.mtimeMs)) {
      console.error(
        "expected target to rebuild after importer-local patch change (mtime not increased)",
      );
      console.error("before:", s1.mtimeMs, "after:", s2.mtimeMs);
      process.exit(2);
    }
  });
});
