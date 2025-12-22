#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test(
  "nix_node_cli_bin(bundle=True) bootstraps WORKSPACE_ROOT via tools/buck/workspace-root.env in temp repos",
  { timeout: 420_000 },
  async () => {
    // This probe needs the dev shell so Buck can execute the genrule far enough to hit bootstrap.
    process.env.TEST_NEED_DEV_ENV = "1";
    await runInTemp("node-cli-bundle-workspace-root-env-probe", async (tmp, $) => {
      const dir = path.join(tmp, "apps", "cli");
      await fsp.mkdir(path.join(dir, "src"), { recursive: true });
      await fsp.writeFile(path.join(dir, "src", "index.ts"), "console.log('cli')\n", "utf8");
      await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "# stub\n", "utf8");

      await fsp.writeFile(
        path.join(dir, "TARGETS"),
        [
          'load("//node:defs.bzl", "nix_node_cli_bin")',
          "",
          "nix_node_cli_bin(",
          '  name = "tool",',
          "  bundle = True,",
          '  labels = ["lockfile:apps/cli/pnpm-lock.yaml#apps/cli"],',
          ")",
          "",
        ].join("\n"),
        "utf8",
      );

      const res = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 build //apps/cli:tool`;

      // We do not require the bundle build to succeed here; this is a bootstrap probe.
      // The key invariant: the action must not fail at the "flake root not found" guard.
      const combined = String(res.stderr || "") + String(res.stdout || "");
      assert.ok(
        !combined.includes("[BNX-BUNDLE] flake.nix not found"),
        "expected bundled CLI to find flake.nix via standardized workspace-root bootstrap (workspace-root.env)",
      );
    });
  },
);
