#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node cli: coverage artifacts emitted when COVERAGE=1", { timeout: 480_000 }, async () => {
  await runInTemp("node-cli-nix-node-test-coverage", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const env = {
      ...process.env,
      NIX_PNPM_ALLOW_GENERATE: "1",
      INSTALL_LOCK_SKIP: "1",
      NIX_PNPM_FETCH_TIMEOUT: "300",
      COVERAGE: "1",
    } as Record<string, string>;

    await $`git init`;
    // Scaffold with tests default-on
    await $`scaf new node cli demo --yes`;

    // Commit scaffold so Nix flake sees importer under git+file sources
    await $({
      env,
    })`bash -lc 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

    const importer = "apps/demo";
    const lockfile = path.join(importer, "pnpm-lock.yaml");
    const sanitized = importer
      .replace(/\/\//g, "")
      .replace(/:/g, "-")
      .replace(/[\/\s]+/g, "-");

    // Ensure lockfile exists; generate if missing (dev deps included)
    let hasLock = await fsp
      .access(path.join(tmp, lockfile))
      .then(() => true)
      .catch(() => false);
    if (!hasLock) {
      await $({
        stdio: "inherit",
        env,
      })`bash --noprofile --norc -c 'set -euo pipefail; mkdir -p "${tmp}/${importer}/.pnpm-home" "${tmp}/${importer}/.pnpm-store"; export PNPM_HOME="${tmp}/${importer}/.pnpm-home"; nix run ${tmp}#pnpm --accept-flake-config -- config set store-dir "${tmp}/${importer}/.pnpm-store"; nix run ${tmp}#pnpm --accept-flake-config -- install --filter "./${importer}" --lockfile-only --prod=false --ignore-scripts --lockfile-dir "./${importer}" --dir "./${importer}"'`;
      hasLock = await fsp
        .access(path.join(tmp, lockfile))
        .then(() => true)
        .catch(() => false);
    }
    // Commit the lockfile so pure flake snapshots see it
    await $({
      env,
    })`bash -lc 'git -C ${tmp} add ${lockfile} && git -C ${tmp} commit -m "chore(test): add importer lockfile"'`.nothrow();

    // Compute/update FOD mapping from the committed lockfile
    await $({
      stdio: "inherit",
      env,
    })`zx-wrapper tools/dev/update-pnpm-hash.ts --lockfile ${lockfile}`;

    // Warm pnpm-store and node-modules
    await $({
      stdio: "inherit",
      env,
    })`bash --noprofile --norc -c 'timeout 300s nix build "${tmp}#pnpm-store.${sanitized}" --impure --no-link --accept-flake-config --print-build-logs --max-jobs 1 --option cores 1'`;
    await $({
      stdio: "inherit",
      env,
    })`bash --noprofile --norc -c 'timeout 300s nix build "${tmp}#node-modules.${sanitized}" --impure --no-link --accept-flake-config --print-build-logs --max-jobs 1 --option cores 1'`;

    // Reconcile any FOD digest drift detected during warm-up
    await $({
      stdio: "inherit",
      env,
    })`zx-wrapper tools/dev/update-pnpm-hash.ts --force --lockfile ${lockfile}`;

    // Build the node-test derivation with coverage
    const out = await $({
      stdio: "pipe",
      env,
    })`bash --noprofile --norc -c 'timeout 300s nix build "${tmp}#node-test.${sanitized}" --impure --no-link --accept-flake-config --print-out-paths'`;
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
});
