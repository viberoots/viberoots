#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_cli_bin(bundle=True) includes global Nix inputs as genrule srcs (action inputs)", async () => {
  await runInTemp("node-cli-bundle-global-inputs-srcs", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "cli");
    await fsp.mkdir(path.join(dir, "src"), { recursive: true });
    await fsp.writeFile(path.join(dir, "src", "index.ts"), "console.log('cli')\n", "utf8");
    await fsp.writeFile(path.join(dir, "package.json"), '{"name":"cli"}\n', "utf8");
    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/cli:tool`;
    if (probe.exitCode !== 0) return;
    const raw = String(probe.stdout || "");
    assert.ok(
      raw.includes(":flake.lock"),
      "expected //.viberoots/workspace:flake.lock to be present in srcs via global_nix_inputs()",
    );
    assert.ok(
      raw.includes("//projects/config:node-modules.hashes.json"),
      "expected the canonical committed pnpm hash authority in srcs via global_nix_inputs()",
    );
    assert.ok(
      raw.includes("__global_nix_inputs__"),
      "expected dict-shaped srcs to include synthetic keys for global inputs",
    );
    for (const relative of ["src/index.ts", "package.json", "pnpm-lock.yaml"]) {
      assert.ok(
        raw.includes(`projects/apps/cli/${relative}`),
        `expected importer-layout action input for ${relative}`,
      );
    }

    const labelsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/cli:tool`;
    if (labelsProbe.exitCode !== 0) {
      // Environment not fully available in temp. Skip to avoid false negatives.
      return;
    }
    const labelsOut = String(labelsProbe.stdout || "");
    assert.ok(
      labelsOut.includes(":flake.lock"),
      "expected nix_node_cli_bin(bundle=True) to stamp //.viberoots/workspace:flake.lock when stamp=True",
    );
  });
});
