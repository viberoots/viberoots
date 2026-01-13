#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { ensureImporterLockfileFresh } from "../../lib/pnpm-importer-lockfile";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";

/**
 * Stabilization strategy:
 * - Allow lockfile generation (no network in FOD) and use the update-pnpm-hash helper to compute the FOD digest.
 * - Warm pnpm-store and node-modules derivations.
 * - Re-run update to reconcile any drift after warm-up.
 * - Build the node-test derivation directly via Nix and assert a report is produced.
 */

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "node lib: nix_node_test passes with sample tests present (default)",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("node-lib-nix-node-test-with-tests", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      const TIMEOUT_SECS = String(
        Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200"),
      );
      const env = {
        ...process.env,
        // Force all subprocesses in this test to treat the temp repo as the workspace.
        // This avoids pulling volatile dirs (like the real repo's coverage/raw) into Nix snapshots
        // and avoids sourcing user login profiles from the real HOME.
        WORKSPACE_ROOT: tmp,
        HOME: tmp,
        NIX_PNPM_ALLOW_GENERATE: "1",
        NIX_PNPM_FETCH_TIMEOUT: String(Number(process.env.NIX_PNPM_FETCH_TIMEOUT || "600")),
        NODE_TEST_TIMEOUT: String(
          Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200"),
        ),
      } as Record<string, string>;

      await $`git init`;
      // Scaffold with tests default-on
      await $`scaf new node lib demo --yes --skip-lockfile-gen`;

      // Commit scaffold so Nix flake sees importer under git+file sources
      await $({
        env,
      })`bash --noprofile --norc -c 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

      const importer = "libs/demo";
      const lockfile = path.join(importer, "pnpm-lock.yaml");
      const sanitized = importer
        .replace(/\/\//g, "")
        .replace(/:/g, "-")
        .replace(/[\/\s]+/g, "-");

      // 1) Ensure the importer lockfile is real and consistent with package.json.
      await ensureImporterLockfileFresh({
        tmp,
        $,
        env,
        importerRel: importer,
        nixPnpmFetchTimeoutSecs: String(env.NIX_PNPM_FETCH_TIMEOUT || "600"),
      });
      // Commit the lockfile so pure flake snapshots see it
      await $({
        env,
      })`bash --noprofile --norc -c 'git -C ${tmp} add ${lockfile} && git -C ${tmp} commit -m "chore(test): add importer lockfile"'`.nothrow();

      // 2) Compute/update FOD mapping from the committed lockfile
      await $({
        stdio: "inherit",
        env,
      })`zx-wrapper tools/dev/update-pnpm-hash.ts --lockfile ${lockfile}`;

      // 3) Warm pnpm-store and node-modules
      {
        const mj = String(process.env.NIX_MAX_JOBS || "0");
        const cr = String(process.env.NIX_CORES || "0");
        const flags = [
          mj && mj !== "0" ? `--max-jobs ${mj}` : "",
          cr && cr !== "0" ? `--option cores ${cr}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        const cmd1 = `set -euo pipefail; timeout ${TIMEOUT_SECS}s nix build "${tmp}#pnpm-store.${sanitized}" --impure --no-link --accept-flake-config --builders "" --print-build-logs ${flags}`;
        await $({ stdio: "inherit", env })`bash --noprofile --norc -c ${cmd1}`;
        const cmd2 = `set -euo pipefail; timeout ${TIMEOUT_SECS}s nix build "${tmp}#node-modules.${sanitized}" --impure --no-link --accept-flake-config --builders "" --print-build-logs ${flags}`;
        await $({ stdio: "inherit", env })`bash --noprofile --norc -c ${cmd2}`;
      }

      // 4) Reconcile any FOD digest drift detected during warm-up; force rehash to align mapping
      await $({
        stdio: "inherit",
        env,
      })`zx-wrapper tools/dev/update-pnpm-hash.ts --force --lockfile ${lockfile}`;

      // 5) Build the node-test derivation; sample tests should pass
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
        return await $({ stdio: "pipe", env })`bash --noprofile --norc -c ${cmd}`;
      })();
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
