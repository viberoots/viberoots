#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, exists } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "node-test: derivation succeeds with no tests present",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("node-test-no-tests", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      const TIMEOUT_SECS = String(
        Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200"),
      );
      const importer = "projects/apps/demo-node";
      const impDir = path.join(tmp, importer);
      await fsp.mkdir(impDir, { recursive: true });
      // Minimal package.json without test runner deps; no test files created
      await fsp.writeFile(
        path.join(impDir, "package.json"),
        JSON.stringify(
          { name: "@demo/node", version: "0.0.1", private: true, type: "module" },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      // runInTemp initializes a git repo; stage generated files so Nix git-flake evaluation sees them.
      await $({ cwd: tmp, stdio: "pipe" })`git add -A ${importer}`;
      // Allow lockfile generation and compute/update pnpm-store FOD hash
      const env = {
        ...process.env,
        NIX_PNPM_ALLOW_GENERATE: "1",
      } as Record<string, string>;
      await $({
        cwd: tmp,
        stdio: "inherit",
        env,
      })`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${path.join(importer, "pnpm-lock.yaml")}`;
      await $({ cwd: tmp, stdio: "pipe" })`git add -A ${importer}`;
      // Do NOT prebuild pnpm-store/node-modules here: the purpose of this test is to ensure
      // node-test can succeed quickly when no tests exist, without forcing heavyweight deps.
      // If node-test incorrectly depends on node-modules, this test will regress in wall time.
      const sanitized = importer
        .replace(/\/\//g, "")
        .replace(/:/g, "-")
        .replace(/[\/\s]+/g, "-");
      // Build the node-test derivation; no tests present so it should pass
      const out = await $({
        cwd: tmp,
        stdio: "pipe",
        env,
      })`bash --noprofile --norc -c 'timeout ${TIMEOUT_SECS}s nix build "${tmp}#node-test.${sanitized}" --impure --no-link --accept-flake-config --builders "" --print-out-paths'`;
      const outPath =
        String(out.stdout || "")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .pop() || "";
      if (!outPath) throw new Error("nix build returned no out path for node-test");
      const reportDir = path.join(outPath, "report");
      if (!(await exists(reportDir)))
        throw new Error("report/ directory missing in node-test output");
    });
  },
);
