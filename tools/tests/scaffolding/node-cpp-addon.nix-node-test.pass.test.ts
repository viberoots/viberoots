#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node cpp-addon: scaffold, build addon, and pass nix_node_test", async () => {
  await runInTemp("node-cpp-addon-nix-node-test", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const env = {
      ...process.env,
      NIX_PNPM_ALLOW_GENERATE: "1",
      INSTALL_LOCK_SKIP: "1",
      NIX_PNPM_FETCH_TIMEOUT: "300",
    } as Record<string, string>;

    await $`git init`;
    // Scaffold the Node TS package and C++ addon sibling
    await $`scaf new node cpp-addon demo --yes`;

    const importer = "libs/demo";
    const sanitized = importer
      .replace(/\/\//g, "")
      .replace(/:/g, "-")
      .replace(/[\/\s]+/g, "-");
    const lockfile = path.join(importer, "pnpm-lock.yaml");

    // Commit scaffold so pure flake snapshots see new importers
    await $({
      env,
    })`bash -lc 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

    // Ensure a lockfile exists for the importer; generate if missing
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

    // Reconcile any FOD digest drift detected during warm-up; force rehash to align mapping
    await $({
      stdio: "inherit",
      env,
    })`zx-wrapper tools/dev/update-pnpm-hash.ts --force --lockfile ${lockfile}`;

    // Build the node-test derivation; vitest should pass calling through the native addon
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
    // Check junit report presence as a basic signal
    const reportDir = path.join(outPath, "report");
    const entries = await fsp.readdir(reportDir).catch(() => []);
    if (entries.length === 0) throw new Error("node-test report directory is empty");
  });
});
