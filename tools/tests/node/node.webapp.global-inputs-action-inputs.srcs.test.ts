#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp includes global Nix inputs as genrule srcs (action inputs)", async () => {
  await runInTemp("node-webapp-global-inputs-srcs", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//node:defs.bzl", "node_webapp")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  labels = ["lockfile:apps/web/pnpm-lock.yaml#apps/web"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //apps/web:bundle`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes(":flake.lock"),
      "expected //:flake.lock to be present in srcs via global_nix_inputs()",
    );
  });
});
