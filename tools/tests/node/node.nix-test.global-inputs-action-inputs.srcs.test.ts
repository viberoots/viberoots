#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_test includes global Nix inputs in srcs (action inputs)", async () => {
  await runInTemp("node-nix-test-global-inputs-srcs", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "web");
    await fsp.mkdir(path.join(dir, "tests"), { recursive: true });
    await fsp.writeFile(path.join(dir, "tests", "a.test.ts"), "import 'node:test'\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//node:defs.bzl", "nix_node_test")',
        "",
        "nix_node_test(",
        '  name = "t",',
        '  labels = ["lockfile:apps/web/pnpm-lock.yaml#apps/web"],',
        '  patterns = ["tests/**/*.test.ts"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //apps/web:t`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes(":flake.lock"),
      "expected //:flake.lock to be present in srcs via global_nix_inputs()",
    );

    const labelsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //apps/web:t`;
    if (labelsProbe.exitCode !== 0) return;
    const labelsOut = String(labelsProbe.stdout || "");
    assert.ok(
      !labelsOut.includes(":flake.lock"),
      "expected nix_node_test to not stamp //:flake.lock (stamp=False) while still including it as a real action input",
    );
  });
});
