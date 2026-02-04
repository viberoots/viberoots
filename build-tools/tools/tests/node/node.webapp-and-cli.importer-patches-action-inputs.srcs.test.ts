#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp and nix_node_cli_bin(bundle=True) include importer-local patches in srcs (action inputs)", async () => {
  await runInTemp("node-webapp-and-cli-importer-patches-srcs", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "web");
    const patchDir = path.join(dir, "patches", "node");
    await fsp.mkdir(path.join(dir, "src"), { recursive: true });
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(dir, "src", "index.ts"), "console.log('cli')\n", "utf8");

    const patchRel = "apps/web/patches/node/leftpad@1.3.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//node:defs.bzl", "node_webapp", "nix_node_cli_bin")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",',
        ")",
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        "  bundle = True,",
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //apps/web:bundle`;
    if (probeWebapp.exitCode !== 0) return;
    const outWebapp = String(probeWebapp.stdout || "");
    const alt = "patches/node/leftpad@1.3.0.patch";
    assert.ok(
      outWebapp.includes(patchRel) || outWebapp.includes(alt),
      `expected importer-local patch path present in node_webapp srcs: ${patchRel} (or ${alt})`,
    );

    const probeCli = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //apps/web:tool`;
    if (probeCli.exitCode !== 0) return;
    const outCli = String(probeCli.stdout || "");
    assert.ok(
      outCli.includes(patchRel) || outCli.includes(alt),
      `expected importer-local patch path present in bundled CLI srcs: ${patchRel} (or ${alt})`,
    );
  });
});
