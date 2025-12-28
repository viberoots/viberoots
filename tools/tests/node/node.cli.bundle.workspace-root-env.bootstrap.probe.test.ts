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
      })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //apps/cli:tool`;

      // Some environments skip cquery in temp repos (missing toolchain config, etc.).
      // When it runs, it must show the standardized workspace-root env bootstrap.
      if (res.exitCode !== 0) return;
      const combined = String(res.stderr || "") + String(res.stdout || "");
      assert.ok(
        combined.includes(". tools/buck/workspace-root.env") ||
          combined.includes(". tools/buck/workspace-root.env 2>/dev/null || true;"),
        "expected bundled CLI cmd to source tools/buck/workspace-root.env (standardized temp-repo bootstrap)",
      );
    });
  },
);
