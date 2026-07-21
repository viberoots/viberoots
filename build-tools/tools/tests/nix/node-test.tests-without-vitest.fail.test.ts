#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { runFilteredFlakeAttr } from "../lib/test-helpers/selected-build";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "node-test: fails when tests exist but vitest is missing",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("node-test-missing-vitest", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      const importer = "projects/apps/demo-node";
      const impDir = path.join(tmp, importer);
      await fsp.mkdir(path.join(impDir, "src"), { recursive: true });
      await fsp.writeFile(
        path.join(impDir, "package.json"),
        JSON.stringify(
          {
            name: "@demo/node",
            version: "0.0.1",
            private: true,
            type: "module",
            devDependencies: { typescript: "^5.9.3" },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await fsp.writeFile(
        path.join(impDir, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\n\nimporters:\n  .:\n    devDependencies:\n      typescript:\n        specifier: ^5.9.3\n        version: 5.9.3\n",
        "utf8",
      );
      await fsp.writeFile(
        path.join(impDir, "TARGETS"),
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_test")\n\nnix_node_test(\n    name = "demo-node-tests",\n)\n',
        "utf8",
      );
      // Create a test file that matches the default pattern
      await fsp.writeFile(
        path.join(impDir, "src", "sample.test.ts"),
        "export const x = 1;\n",
        "utf8",
      );
      const env = { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" } as Record<string, string>;
      const sanitized = importer
        .replace(/\/\//g, "")
        .replace(/:/g, "-")
        .replace(/[\/\s]+/g, "-");
      // Ensure graph/glue files include this importer before querying node-test attr.
      await $({
        cwd: tmp,
        stdio: "inherit",
        env,
      })`zx-wrapper viberoots/build-tools/tools/dev/install/deps-main.ts --verbose --glue-only`;
      await $({ cwd: tmp, stdio: "pipe" })`git add -A ${importer}`;
      // Expect build to fail because tests are present but vitest is not installed
      const res = await runFilteredFlakeAttr({
        tmp,
        $,
        target: `//${importer}:demo-node-tests`,
        attr: `node-test.${sanitized}`,
        env,
        nothrow: true,
      });
      if (res.exitCode === 0) {
        throw new Error(
          "expected node-test derivation to fail when vitest is missing and tests exist",
        );
      }
      const out = `${String(res.stdout || "")}\n${String(res.stderr || "")}`;
      if (!out.includes("tests exist but vitest is not present")) {
        throw new Error(`unexpected failure mode for missing vitest check:\n${out}`);
      }
    });
  },
);
