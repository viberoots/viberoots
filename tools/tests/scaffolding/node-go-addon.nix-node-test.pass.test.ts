#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

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
      process.env.TEST_RSYNC_ROOTS = "tools toolchains go node lang third_party/providers patches";
    }
    try {
      await runInTemp("node-go-addon-nix-node-test", async (tmp, _$) => {
        const $ = _$;
        const rawTimeoutSecs = Number(
          process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200",
        );
        // This zx_test action has a hard Buck-side timeout (currently 10 minutes). Keep the
        // internal nix build timeout comfortably below that so we fail deterministically rather
        // than being SIGKILL'd (which can strand nix-daemon builders).
        const TIMEOUT_SECS = String(Math.min(rawTimeoutSecs, 9 * 60));
        const NIX_PNPM_FETCH_TIMEOUT = String(Number(process.env.NIX_PNPM_FETCH_TIMEOUT || "600"));

        await $`git init`;

        // Scaffold the Node TS package, Go c-archive sibling, and C N-API addon sibling
        await $`scaf new node go-addon demo --yes`;

        // Basic assertions on created files
        const nodePkg = path.join(tmp, "libs", "demo");
        const goPkg = path.join(tmp, "libs", "demo-go");
        const nativePkg = path.join(tmp, "libs", "demo-native");
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

        const importer = "libs/demo";
        const sanitized = importer
          .replace(/\/\//g, "")
          .replace(/:/g, "-")
          .replace(/[\/\s]+/g, "-");
        const lockfile = path.join(importer, "pnpm-lock.yaml");

        // Install deps and ensure gomod2nix.toml is generated for libs/demo-go
        await $({
          stdio: "inherit",
        })`env NIX_PNPM_ALLOW_GENERATE=1 NIX_PNPM_FETCH_TIMEOUT=${NIX_PNPM_FETCH_TIMEOUT} ${path.join(
          tmp,
          "tools/bin/i",
        )}`;

        // Build the importer's Node tests; the builder links the Go c-archive into the addon
        const testOut = await (async () => {
          const mj = String(process.env.NIX_MAX_JOBS || "0");
          const cr = String(process.env.NIX_CORES || "0");
          const flags = [
            mj && mj !== "0" ? `--max-jobs ${mj}` : "",
            cr && cr !== "0" ? `--option cores ${cr}` : "",
          ]
            .filter(Boolean)
            .join(" ");
          const cmd = `set -euo pipefail; timeout ${TIMEOUT_SECS}s env NIX_PNPM_ALLOW_GENERATE=1 NIX_PNPM_FETCH_TIMEOUT=${NIX_PNPM_FETCH_TIMEOUT} nix build "${tmp}#node-test.${sanitized}" -L --impure --no-link --accept-flake-config --builders "" --print-out-paths ${flags}`;
          return await $({
            stdio: "pipe",
          })`bash --noprofile --norc -c ${cmd}`;
        })();
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
