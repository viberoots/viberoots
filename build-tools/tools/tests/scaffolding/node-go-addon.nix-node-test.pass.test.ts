#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";
import { exportGraphInTemp, runFilteredFlakeAttr } from "../lib/test-helpers/selected-build";
import { viberootsDevTool } from "./lib/viberoots-tools";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";
process.env.NIX_PNPM_ALLOW_GENERATE = "1";
process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "600";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "node go-addon: scaffold, build addon, and pass nix_node_test",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const prevRoots = process.env.TEST_RSYNC_ROOTS;
    if (!prevRoots) {
      process.env.TEST_RSYNC_ROOTS =
        "viberoots/build-tools toolchains third_party/providers patches";
    }
    try {
      await runInTemp("node-go-addon-nix-node-test", async (tmp, _$) => {
        const $ = _$({ cwd: tmp, stdio: "pipe" });
        const NIX_PNPM_FETCH_TIMEOUT = String(Number(process.env.NIX_PNPM_FETCH_TIMEOUT || "600"));
        const env = {
          ...process.env,
          NIX_PNPM_ALLOW_GENERATE: "1",
          NIX_PNPM_FETCH_TIMEOUT,
        } as Record<string, string>;

        await $`git init`;

        // Scaffold the Node TS package, Go c-archive sibling, and C N-API addon sibling
        await $`scaf new ts go-addon demo --yes --skip-lockfile-gen`;

        // Basic assertions on created files
        const nodePkg = path.join(tmp, "projects", "libs", "demo");
        const goPkg = path.join(tmp, "projects", "libs", "demo-go");
        const nativePkg = path.join(tmp, "projects", "libs", "demo-native");
        for (const p of [
          path.join(nodePkg, "package.json"),
          path.join(nodePkg, "src", "index.ts"),
          path.join(nodePkg, "TARGETS"),
          path.join(goPkg, "pkg", "addon", "addon.go"),
          path.join(goPkg, "TARGETS"),
          path.join(nativePkg, "src", "binding.c"),
          path.join(nativePkg, "TARGETS"),
        ]) {
          if (!(await exists(p))) {
            throw new Error(`expected file missing: ${p}`);
          }
        }

        // Commit scaffold so pure flake snapshots see new importers
        await $`bash --noprofile --norc -c 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

        const importer = "projects/libs/demo";
        const lockfile = path.join(importer, "pnpm-lock.yaml");

        // Align fixed-output hash for the importer before building node-test.
        await $({
          stdio: "inherit",
          env,
        })`zx-wrapper ${viberootsDevTool("update-pnpm-hash.ts")} --lockfile ${lockfile}`;

        // Build the importer's Node tests; the builder links the Go c-archive into the addon
        await exportGraphInTemp({ tmp, $, env });
        const testOut = await runFilteredFlakeAttr({
          tmp,
          $,
          target: "//projects/libs/demo:unit",
          attr: "node-test.projects-libs-demo",
          env,
        });
        const outPath =
          String(testOut.stdout || "")
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
            .pop() || "";
        if (!outPath) throw new Error("node-test derivation returned no out path");
        // Verify the test report exists and is non-empty
        const reportDir = path.join(outPath, "report");
        const entries = await fsp.readdir(reportDir).catch(() => []);
        if (entries.length === 0) throw new Error("node-test report is empty");
      });
    } finally {
      if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
      else process.env.TEST_RSYNC_ROOTS = prevRoots;
    }
  },
);
