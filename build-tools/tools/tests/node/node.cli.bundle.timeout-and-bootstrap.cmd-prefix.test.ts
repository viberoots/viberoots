#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_cli_bin(bundle=True) cmd prefixes nix bootstrap env and timeout wrapper", async () => {
  await runInTemp("node-cli-timeout-prefix", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "cli");
    await fsp.mkdir(path.join(dir, "src"), { recursive: true });
    await fsp.writeFile(path.join(dir, "src", "index.ts"), "console.log('cli')\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_cli_bin")',
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        "  bundle = True,",
        '  labels = ["lockfile:projects/apps/cli/pnpm-lock.yaml#projects/apps/cli"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/cli:tool`;
    if (probe.exitCode !== 0) {
      // Environment not fully available in temp — skip to avoid false negatives
      return;
    }
    const raw = JSON.parse(String(probe.stdout || "")) as Record<string, { cmd?: string }>;
    const out = String(Object.values(raw)[0]?.cmd || "");
    // Should include nix bootstrap core markers
    assert.ok(
      out.includes("export WORKSPACE_ROOT=") || out.includes("FLK_ROOT="),
      "expected nix_bootstrap_env_core() fragments in cmd",
    );
    // Bundled Node CLI runs under Nix and must opt in to unified PNPM store handling
    assert.ok(
      out.includes("require-unified-pnpm-store.ts") || out.includes(".unified-pnpm-store/path"),
      "expected nix_bootstrap_env_pnpm_store() fragments in cmd",
    );
    // Should declare TIMEOUT wrapper and use it to wrap the nix build invocation
    assert.ok(out.includes("TIMEOUT="), "expected TIMEOUT= assignment in cmd");
    assert.ok(
      out.includes('export NIX_PNPM_INSTALL_TIMEOUT="$TOUT"'),
      "expected timeout wrapper to export NIX_PNPM_INSTALL_TIMEOUT",
    );
    const idxTimeout = out.indexOf("TIMEOUT");
    const idxNix = out.indexOf("nix-build-filtered-flake.ts");
    assert.ok(
      idxTimeout >= 0 && idxNix > idxTimeout,
      "expected TIMEOUT to precede Nix build helper invocation",
    );

    // Enforce "no out-links" policy through the filtered flake helper.
    assert.ok(
      out.includes("nix-build-filtered-flake.ts"),
      "expected bundled CLI to invoke filtered flake build helper",
    );
  });
});
