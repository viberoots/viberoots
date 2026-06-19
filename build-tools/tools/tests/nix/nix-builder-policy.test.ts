#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  localOnlyNixBuilderArgs,
  nixBuilderPolicyArgs,
  nixBuilderPolicyShellArgs,
} from "../../lib/nix-builder-policy";

test("TypeScript Nix builder policy renders explicit local-only builders", () => {
  assert.deepEqual(localOnlyNixBuilderArgs(), ["--builders", ""]);
  assert.deepEqual(nixBuilderPolicyArgs({ policy: "inherit_config" }), []);
  assert.deepEqual(
    nixBuilderPolicyArgs({ policy: "force_builders_file", buildersFile: "/tmp/machines" }),
    ["--builders", "@/tmp/machines"],
  );
  assert.equal(nixBuilderPolicyShellArgs("local_only"), '--builders ""');
  assert.match(nixBuilderPolicyShellArgs("force_builders_file"), /requires VBR_NIX_BUILDERS_FILE/);
});

test("Starlark Nix builder policy constants and renderer stay available", () => {
  const text = fs.readFileSync("viberoots/build-tools/lang/nix_builder_policy.bzl", "utf8");
  assert.match(text, /NIX_BUILDER_LOCAL_ONLY = "local_only"/);
  assert.match(text, /NIX_BUILDER_INHERIT_CONFIG = "inherit_config"/);
  assert.match(text, /NIX_BUILDER_FORCE_BUILDERS_FILE = "force_builders_file"/);
  assert.match(text, /def nix_builder_policy_args/);
  assert.match(text, /--builders ""/);
});

test("production local-only --builders usage is classified through policy helpers", () => {
  const productionFiles = [
    "viberoots/build-tools/tools/buck/node-cli-bundle.ts",
    "viberoots/build-tools/tools/dev/node-modules-build.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/nix.ts",
  ];
  for (const file of productionFiles) {
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /nix-builder-policy/);
  }

  const searched = [
    "viberoots/build-tools/tools",
    "viberoots/build-tools/lang",
    "viberoots/toolchains",
  ].flatMap((dir) => fs.readdirSync(dir, { recursive: true }).map((entry) => `${dir}/${entry}`));
  const offenders = searched.filter((file) => {
    if (!file.match(/\.(ts|bzl|nix)$/)) return false;
    if (file.includes("/tests/")) return false;
    if (file.endsWith("nix-builder-policy.ts")) return false;
    if (file.endsWith("nix_builder_policy.bzl")) return false;
    if (file.endsWith("remote_action_policy.bzl")) return false;
    return fs.readFileSync(file, "utf8").includes('--builders ""');
  });
  assert.deepEqual(offenders, []);
});
