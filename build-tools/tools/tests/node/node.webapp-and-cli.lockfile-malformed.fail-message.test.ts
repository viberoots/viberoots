#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp and nix_node_cli_bin(bundle=True) fail deterministically when lockfile label is malformed", async () => {
  await runInTemp("node-webapp-and-cli-lockfile-malformed", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(path.join(dir, "src"), { recursive: true });
    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(dir, "src", "index.ts"), "console.log('cli')\n", "utf8");

    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "node_webapp", "nix_node_cli_bin")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml",',
        ")",
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        "  bundle = True,",
        '  lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probeWebapp = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //projects/apps/web:bundle`;
    assert.notEqual(
      probeWebapp.exitCode,
      0,
      "expected cquery to fail for node_webapp with malformed lockfile label",
    );
    const outWebapp = String(probeWebapp.stderr || "") + String(probeWebapp.stdout || "");
    assert.ok(
      outWebapp.includes("missing '#<importer>'"),
      `expected deterministic error text for malformed lockfile label (node_webapp), got: ${outWebapp}`,
    );

    const probeCli = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //projects/apps/web:tool`;
    assert.notEqual(
      probeCli.exitCode,
      0,
      "expected cquery to fail for nix_node_cli_bin(bundle=True) with malformed lockfile label",
    );
    const outCli = String(probeCli.stderr || "") + String(probeCli.stdout || "");
    assert.ok(
      outCli.includes("missing '#<importer>'"),
      `expected deterministic error text for malformed lockfile label (nix_node_cli_bin bundle), got: ${outCli}`,
    );
  });
});
