#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { reconcileTempDependencyInputs, runInTemp, exists } from "../lib/test-helpers";
import { runFilteredFlakeAttr } from "../lib/test-helpers/selected-build";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "node-test: derivation succeeds with no tests present",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("node-test-no-tests", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
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
      await fsp.writeFile(
        path.join(impDir, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n",
        "utf8",
      );
      await fsp.writeFile(
        path.join(impDir, "TARGETS"),
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_test")\n\nnix_node_test(\n    name = "demo-node-tests",\n)\n',
        "utf8",
      );
      // runInTemp initializes a git repo; stage generated files so Nix git-flake evaluation sees them.
      await $({ cwd: tmp, stdio: "pipe" })`git add -A ${importer}`;
      // Keep the Nix build environment explicit after the intentional dependency update.
      const env = {
        ...process.env,
        NIX_PNPM_ALLOW_GENERATE: "1",
      } as Record<string, string>;
      await reconcileTempDependencyInputs(tmp, _$);
      await $({ cwd: tmp, stdio: "pipe" })`git add -A ${importer}`;
      // Do NOT prebuild pnpm-store/node-modules here: the purpose of this test is to ensure
      // node-test can succeed quickly when no tests exist, without forcing heavyweight deps.
      // If node-test incorrectly depends on node-modules, this test will regress in wall time.
      const sanitized = importer
        .replace(/\/\//g, "")
        .replace(/:/g, "-")
        .replace(/[\/\s]+/g, "-");
      const out = await runFilteredFlakeAttr({
        tmp,
        $,
        target: `//${importer}:demo-node-tests`,
        attr: `node-test.${sanitized}`,
        env,
      });
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
