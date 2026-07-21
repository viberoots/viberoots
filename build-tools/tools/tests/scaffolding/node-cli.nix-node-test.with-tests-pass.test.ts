#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { exportGraphInTemp, runFilteredFlakeAttr } from "../lib/test-helpers/selected-build";
import { viberootsDevTool } from "./lib/viberoots-tools";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";
process.env.NIX_PNPM_ALLOW_GENERATE = "1";
process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "600";

/**
 * Stabilization strategy mirrors the lib test.
 */

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "node cli: nix_node_test passes with sample tests present (default)",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("node-cli-nix-node-test-with-tests", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      process.env.NODE_TEST_TIMEOUT = String(
        Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200"),
      );

      await $`git init`;
      // Scaffold with tests default-on
      await $`scaf new ts cli demo --yes --skip-lockfile-gen`;

      const importer = "projects/apps/demo";
      const lockfile = path.join(importer, "pnpm-lock.yaml");
      // Require the primary scaffold path to produce the lockfile.
      await fsp.access(path.join(tmp, lockfile));

      // Commit scaffold so Nix flake sees importer under git+file sources (including the lockfile).
      await $`bash --noprofile --norc -c 'set -euo pipefail; git -C ${tmp} config user.email test@example.com; git -C ${tmp} config user.name test; git -C ${tmp} add -A; git -C ${tmp} commit -m scaffold'`;
      await $`bash --noprofile --norc -c 'set -euo pipefail; git -C ${tmp} ls-files --error-unmatch ${lockfile} >/dev/null'`;

      // Align the fixed-output hash mapping for this importer before building node-test.
      await $({
        stdio: "inherit",
      })`zx-wrapper ${viberootsDevTool("update-pnpm-hash.ts")} --lockfile ${lockfile}`;
      await exportGraphInTemp({ tmp, $ });
      const out = await runFilteredFlakeAttr({
        tmp,
        $,
        target: "//projects/apps/demo:unit",
        attr: "node-test.projects-apps-demo",
      });
      const outPath =
        String(out.stdout || "")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .pop() || "";
      if (!outPath) throw new Error("nix build returned no out path for node-test");
      const reportDir = path.join(outPath, "report");
      const entries = await fsp.readdir(reportDir).catch(() => []);
      if (entries.length === 0) throw new Error("node-test report directory is empty");
    });
  },
);
