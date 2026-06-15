#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsDevTool } from "./lib/viberoots-tools";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";
process.env.NIX_PNPM_ALLOW_GENERATE = "1";
process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "600";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "node cli: coverage artifacts emitted when COVERAGE=1",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("node-cli-nix-node-test-coverage", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      const TIMEOUT_SECS = String(
        Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200"),
      );
      process.env.NODE_TEST_TIMEOUT = String(
        Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200"),
      );

      await $`git init`;
      // Scaffold with tests default-on
      await $`scaf new ts cli demo --yes --skip-lockfile-gen`;

      // Commit scaffold so Nix flake sees importer under git+file sources
      await $`bash --noprofile --norc -c 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

      const importer = "projects/apps/demo";
      const lockfile = path.join(importer, "pnpm-lock.yaml");
      const sanitized = importer
        .replace(/\/\//g, "")
        .replace(/:/g, "-")
        .replace(/[\/\s]+/g, "-");

      // Align the fixed-output hash mapping for this importer before building node-test.
      await $({
        stdio: "inherit",
      })`zx-wrapper ${viberootsDevTool("update-pnpm-hash.ts")} --lockfile ${lockfile}`;

      // Build the node-test derivation with coverage
      const out = await (async () => {
        const mj = String(process.env.NIX_MAX_JOBS || "0");
        const cr = String(process.env.NIX_CORES || "0");
        const flags = [
          mj && mj !== "0" ? `--max-jobs ${mj}` : "",
          cr && cr !== "0" ? `--option cores ${cr}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        const cmd = `set -euo pipefail; timeout ${TIMEOUT_SECS}s nix build "${tmp}#node-test.${sanitized}" --impure --no-link --accept-flake-config --builders "" --print-out-paths ${flags}`;
        return await $({
          stdio: "pipe",
          env: { ...process.env, COVERAGE: "1" },
        })`bash --noprofile --norc -c ${cmd}`;
      })();
      const outPath =
        String(out.stdout || "")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .pop() || "";
      if (!outPath) throw new Error("nix build returned no out path for node-test");
      const covDir = path.join(outPath, "coverage");
      const entries = await fsp.readdir(covDir).catch(() => []);
      if (entries.length === 0) throw new Error("coverage directory is empty");
      const lcov = path.join(covDir, "lcov.info");
      const summary = path.join(covDir, "coverage-summary.json");
      // Optional but preferred reporters; skip if absent, assert non-empty if present
      const [lcovStat, summaryStat] = await Promise.all([
        fsp.readFile(lcov, "utf8").catch(() => ""),
        fsp.readFile(summary, "utf8").catch(() => ""),
      ]);
      if (lcovStat && lcovStat.length === 0) throw new Error("lcov.info present but empty");
      if (summaryStat && summaryStat.length === 0)
        throw new Error("coverage-summary.json present but empty");
    });
  },
);
