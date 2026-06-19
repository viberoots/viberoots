#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("planner-visible wiring rejects stale provider realization vocabulary", async () => {
  await runInTemp("planner-visible-rejects-stale-provider-mode", async (tmp, $) => {
    const srcsCase = path.join(tmp, "srcs_case");
    const aliasCase = path.join(tmp, "alias_case");
    await fsp.mkdir(srcsCase, { recursive: true });
    await fsp.mkdir(aliasCase, { recursive: true });

    await fsp.writeFile(
      path.join(srcsCase, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:planner_visible_wiring_probe.bzl", "planner_visible_inputs_probe")',
        "",
        "planner_visible_inputs_probe(",
        '  name = "stale_provider_mode",',
        '  target_name = "t",',
        '  providers = ["//third_party/providers:nix_pkgs_zlib"],',
        '  provider_realization_mode = "srcs",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const staleMode = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo //srcs_case:stale_provider_mode`;
    assert.notEqual(staleMode.exitCode, 0);
    assert.match(String(staleMode.stderr || ""), /'deps', or 'inputs'/);

    await fsp.writeFile(
      path.join(aliasCase, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:planner_visible_wiring_probe.bzl", "planner_visible_inputs_probe")',
        "",
        "planner_visible_inputs_probe(",
        '  name = "stale_alias",',
        '  target_name = "t",',
        '  providers = ["//third_party/providers:nix_pkgs_zlib"],',
        '  realize_providers_into = "inputs",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const staleAlias = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo //alias_case:stale_alias`;
    assert.notEqual(staleAlias.exitCode, 0);
    assert.match(String(staleAlias.stderr || ""), /unexpected keyword|realize_providers_into/);
  });
});
