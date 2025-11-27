#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, exists } from "../lib/test-helpers";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node go-addon: scaffold, build addon, and pass nix_node_test", async () => {
  await runInTemp("node-go-addon-nix-node-test", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const TIMEOUT_SECS = String(
      Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200"),
    );
    const env = {
      ...process.env,
      NIX_PNPM_ALLOW_GENERATE: "1",
      INSTALL_LOCK_SKIP: "1",
      NIX_PNPM_FETCH_TIMEOUT: String(Number(process.env.NIX_PNPM_FETCH_TIMEOUT || "600")),
    } as Record<string, string>;

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
    await $({
      env,
    })`bash -lc 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

    // Ensure a lockfile exists for the importer; generate if missing
    const importer = "libs/demo";
    const sanitized = importer
      .replace(/\/\//g, "")
      .replace(/:/g, "-")
      .replace(/[\/\s]+/g, "-");
    const lockfile = path.join(importer, "pnpm-lock.yaml");
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

    // Install deps and ensure gomod2nix.toml is generated for libs/demo-go
    await $({ stdio: "inherit", env })`${path.join(tmp, "tools/bin/i")}`;

    // Warm pnpm-store and node-modules (derivations are pure; speeds up node-test)
    await $({
      stdio: "inherit",
      env,
    })`bash --noprofile --norc -c 'timeout ${TIMEOUT_SECS}s nix build "${tmp}#pnpm-store.${sanitized}" --impure --no-link --accept-flake-config --print-build-logs --max-jobs 1 --option cores 1'`;
    await $({
      stdio: "inherit",
      env,
    })`bash --noprofile --norc -c 'timeout ${TIMEOUT_SECS}s nix build "${tmp}#node-modules.${sanitized}" --impure --no-link --accept-flake-config --print-build-logs --max-jobs 1 --option cores 1'`;

    // Build the importer's Node tests; the builder links the Go c-archive into the addon
    const testOut = await $({
      stdio: "pipe",
      env: {
        ...process.env,
      },
    })`bash --noprofile --norc -c 'timeout ${TIMEOUT_SECS}s nix build "${tmp}#node-test.${sanitized}" --impure --no-link --accept-flake-config --print-out-paths'`;
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
});
