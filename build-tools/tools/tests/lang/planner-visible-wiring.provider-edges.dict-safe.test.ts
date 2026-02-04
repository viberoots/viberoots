#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("wire_planner_visible_inputs attaches providers dict-safe and stable", async () => {
  await runInTemp("planner-visible-inputs-dict-safe", async (tmp, $) => {
    const targetsPath = path.join(tmp, "TARGETS");
    await fsp.appendFile(
      targetsPath,
      [
        "",
        "# test: planner-visible-wiring.provider-edges.dict-safe.test.ts",
        'load("//lang:planner_visible_wiring_probe.bzl", "planner_visible_inputs_probe")',
        "",
        "planner_visible_inputs_probe(",
        '  name = "dict_safe_inputs",',
        '  target_name = "t",',
        '  providers = ["//third_party/providers:nix_pkgs_zlib", "//third_party/providers:nix_pkgs_openssl", "//third_party/providers:nix_pkgs_zlib"],',
        '  deps = ["//a:x"],',
        '  srcs = { "preexisting": "src/a.txt" },',
        '  extra_srcs = ["//extra:one"],',
        "  srcs_include_deps = True,",
        '  provider_realization_mode = "inputs",',
        "  provider_dict_safe = True,",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo --show-output //:dict_safe_inputs`;

    const txt = String(res.stdout || "").trim();
    const line = txt.split("\n").filter(Boolean)[0] || "";
    const outPath = line.split(/\s+/).pop();
    assert.ok(outPath, "expected output path for dict_safe_inputs");
    const out = path.isAbsolute(outPath!) ? outPath! : path.join(tmp, outPath!);
    const lines = (await fsp.readFile(out, "utf8")).trim().split("\n").filter(Boolean);

    assert.deepEqual(lines, [
      "__provider_edges__/a-x",
      "__provider_edges__/extra-one",
      "__provider_edges__/third_party-providers-nix_pkgs_openssl",
      "__provider_edges__/third_party-providers-nix_pkgs_zlib",
      "preexisting",
    ]);
  });
});
