#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { exportGraphInTemp, runFilteredFlakeAttr } from "../lib/test-helpers/selected-build";
import { viberootsDevTool } from "./lib/viberoots-tools";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "node cpp-addon: scaffold, build addon, and pass nix_node_test",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("node-cpp-addon-nix-node-test", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      const env = {
        ...process.env,
        NIX_PNPM_ALLOW_GENERATE: "1",
        NIX_PNPM_FETCH_TIMEOUT: String(Number(process.env.NIX_PNPM_FETCH_TIMEOUT || "600")),
      } as Record<string, string>;

      await $`git init`;
      // Scaffold the Node TS package and C++ addon sibling
      await $`scaf new ts cpp-addon demo --yes --skip-lockfile-gen`;

      const importer = "projects/libs/demo";
      const lockfile = path.join(importer, "pnpm-lock.yaml");

      // Commit scaffold so pure flake snapshots see new importers
      await $({
        env,
      })`bash --noprofile --norc -c 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

      // Align the fixed-output hash mapping for this importer before building node-test.
      await $({
        stdio: "inherit",
        env,
      })`zx-wrapper ${viberootsDevTool("update-pnpm-hash.ts")} --lockfile ${lockfile}`;
      await $`git add projects/config/node-modules.hashes.json`;
      await $`git commit -m update-hashes`.nothrow();

      await exportGraphInTemp({ tmp, $, env });
      const out = await runFilteredFlakeAttr({
        tmp,
        $,
        target: "//projects/libs/demo:unit",
        attr: "node-test.projects-libs-demo",
        env,
      });
      const outPath =
        String(out.stdout || "")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .pop() || "";
      if (!outPath) throw new Error("nix build returned no out path for node-test");
      // Check junit report presence as a basic signal
      const reportDir = path.join(outPath, "report");
      const entries = await fsp.readdir(reportDir).catch(() => []);
      if (entries.length === 0) throw new Error("node-test report directory is empty");
    });
  },
);
