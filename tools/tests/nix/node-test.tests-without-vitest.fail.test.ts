#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "node-test: fails when tests exist but vitest is missing",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("node-test-missing-vitest", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      const TIMEOUT_SECS = String(
        Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200"),
      );
      const importer = "apps/demo-node";
      const impDir = path.join(tmp, importer);
      await fsp.mkdir(path.join(impDir, "src"), { recursive: true });
      await fsp.writeFile(
        path.join(impDir, "package.json"),
        JSON.stringify(
          { name: "@demo/node", version: "0.0.1", private: true, type: "module" },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      // Create a test file that matches the default pattern
      await fsp.writeFile(
        path.join(impDir, "src", "sample.test.ts"),
        "export const x = 1;\n",
        "utf8",
      );
      // runInTemp initializes a git repo; stage generated files so Nix git-flake evaluation sees them.
      await $({ cwd: tmp, stdio: "pipe" })`git add -A ${importer}`;
      const env = {
        ...process.env,
        NIX_PNPM_ALLOW_GENERATE: "1",
      } as Record<string, string>;
      const sanitized = importer
        .replace(/\/\//g, "")
        .replace(/:/g, "-")
        .replace(/[\/\s]+/g, "-");
      // Ensure lockfile exists and node_modules derivation can be built (this also reconciles pnpm-store hash if needed)
      await $({
        cwd: tmp,
        stdio: "inherit",
        env,
      })`bash --noprofile --norc -c 'set -euo pipefail; mkdir -p "${tmp}/${importer}/.pnpm-home" "${tmp}/${importer}/.pnpm-store"; export PNPM_HOME="${tmp}/${importer}/.pnpm-home"; nix run ${tmp}#pnpm --accept-flake-config -- config set store-dir "${tmp}/${importer}/.pnpm-store"; nix run ${tmp}#pnpm --accept-flake-config -- install --filter "./${importer}" --lockfile-only --prod=false --ignore-scripts --lockfile-dir "./${importer}" --dir "./${importer}"'`;
      // Stage the generated lockfile so Nix git-flake evaluation sees it.
      await $({ cwd: tmp, stdio: "pipe" })`git add -A ${importer}`;
      await $({
        cwd: impDir,
        stdio: "inherit",
        env,
      })`zx-wrapper ../../tools/dev/node-modules-build.ts`;
      await $({ cwd: tmp, stdio: "pipe" })`git add -A ${importer}`;
      // Expect build to fail because tests are present but vitest is not installed
      const res = await $({
        cwd: tmp,
        stdio: "pipe",
        env,
      })`bash --noprofile --norc -c 'timeout ${TIMEOUT_SECS}s nix build "${tmp}#node-test.${sanitized}" --impure --no-link --accept-flake-config --builders "" --print-build-logs'`.nothrow();
      if (res.exitCode === 0) {
        throw new Error(
          "expected node-test derivation to fail when vitest is missing and tests exist",
        );
      }
    });
  },
);
