#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSmokeReport,
  envrcMasksBuilders,
  parseNixConfig,
  relevantNixConfig,
  remoteCiToolsPathEnv,
} from "../../remote-exec/nix-remote-builder-config";

test("NIX_CONFIG parsing keeps remote-builder relevant settings", () => {
  const text = `
experimental-features = nix-command flakes
builders = @/etc/nix/machines
substituters = https://cache.example
trusted-public-keys = cache.example-1:abc
max-jobs = 0
ignored = value
`;
  assert.equal(parseNixConfig(text).builders, "@/etc/nix/machines");
  assert.deepEqual(relevantNixConfig(text), {
    builders: "@/etc/nix/machines",
    substituters: "https://cache.example",
    "trusted-public-keys": "cache.example-1:abc",
    "max-jobs": "0",
  });
});

test("remote builder smoke detects .envrc masking of builders", () => {
  assert.equal(envrcMasksBuilders("export NIX_CONFIG=$'builders =\\nmax-jobs = auto\\n'"), true);
  assert.equal(envrcMasksBuilders("export NIX_CONFIG=$'max-jobs = 0\\n'"), false);
});

test("remote builder smoke reports inherited builders and explicit commands", () => {
  const report = buildSmokeReport({
    nixConfigText: "builders = @/etc/nix/machines\nmax-jobs = 0\n",
    envrcText: "",
    builderUri: "ssh-ng://builder.example",
    probeBuild: true,
  });
  assert.equal(report.policy, "inherit_config");
  assert.equal(report.ok, true);
  assert.deepEqual(report.commands, [
    ["nix", "store", "info", "--store", "ssh-ng://builder.example"],
    ["nix", "build", ".#graph-generator", "--no-link", "--rebuild", "--accept-flake-config"],
  ]);
  assert.ok(report.diagnostics.some((entry) => entry.includes("inherited")));
});

test("remote builder smoke distinguishes forced builder files and disabled builders", () => {
  assert.equal(
    buildSmokeReport({
      nixConfigText: "",
      envrcText: "",
      buildersFile: "/run/generated-machines",
    }).policy,
    "force_builders_file",
  );
  const disabled = buildSmokeReport({ nixConfigText: "builders = \n", envrcText: "" });
  assert.equal(disabled.policy, "disabled");
  assert.equal(disabled.ok, false);
  assert.ok(disabled.diagnostics.some((entry) => entry.includes("disabled")));
  assert.ok(disabled.diagnostics.some((entry) => entry.includes("probe build skipped")));
});

test("remote builder smoke can restrict PATH to remote-ci-tools", () => {
  assert.deepEqual(remoteCiToolsPathEnv("/nix/store/remote-ci-tools", { PATH: "/bin" }), {
    PATH: "/nix/store/remote-ci-tools/bin",
  });
  assert.throws(() => remoteCiToolsPathEnv("relative-tools", {}), /remote-ci-tools/);
});
