#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";

async function read(p: string): Promise<string> {
  return await fsp.readFile(p, "utf8");
}

function assertDoesNotContain(haystack: string, needle: string, msg: string) {
  assert.ok(!haystack.includes(needle), msg);
}

function assertContains(haystack: string, needle: string, msg: string) {
  assert.ok(haystack.includes(needle), msg);
}

function assertNoLineMatches(haystack: string, re: RegExp, msg: string) {
  assert.ok(!re.test(haystack), msg);
}

test("Nix-calling rule implementations use shared nix out-path capture helpers and do not mask failures", async () => {
  const cpp = await read("viberoots/build-tools/cpp/private/nix_build.bzl");
  const wasm = await read("viberoots/build-tools/go/private/nix_build_wasm.bzl");

  for (const [label, src] of [
    ["viberoots/build-tools/cpp/private/nix_build.bzl", cpp],
    ["viberoots/build-tools/go/private/nix_build_wasm.bzl", wasm],
  ] as const) {
    assertNoLineMatches(
      src,
      /^[^\n]*\bnix build\b[^\n]*\|\| true[^\n]*$/m,
      `${label}: expected no failure masking with '|| true' on nix build lines`,
    );
    assertDoesNotContain(
      src,
      "OUT_PATH=$(",
      `${label}: expected no hand-rolled out path capture using command substitution`,
    );
    assertDoesNotContain(
      src,
      "--out-link",
      `${label}: expected nix build to avoid --out-link (no GC roots / stale symlinks)`,
    );
    assertContains(
      src,
      'load("@viberoots//build-tools/lang:nix_shell.bzl"',
      `${label}: expected nix shell helpers to be loaded from @viberoots//build-tools/lang:nix_shell.bzl`,
    );
  }

  assertContains(
    wasm,
    "nix_action_build_selected_out_path_cmd(",
    "viberoots/build-tools/go/private/nix_build_wasm.bzl: expected nix build out path capture to route through nix_action_build_selected_out_path_cmd(...)",
  );
  assertContains(
    wasm,
    'attr = "graph-generator-selected-wasm" if ctx.attrs.use_selected_wasm else "graph-generator-selected"',
    "viberoots/build-tools/go/private/nix_build_wasm.bzl: expected use_selected_wasm to select the canonical graph-generator-selected-wasm attr",
  );
  assertContains(
    cpp,
    "nix-build-filtered-flake.ts",
    "viberoots/build-tools/cpp/private/nix_build.bzl: expected C++ builds to route through the filtered flake helper",
  );
  assertContains(
    cpp,
    "filtered build produced multiple stdout lines",
    "viberoots/build-tools/cpp/private/nix_build.bzl: expected filtered build stdout to fail closed unless it contains one output path",
  );

  assertDoesNotContain(
    wasm,
    "|| true",
    "viberoots/build-tools/go/private/nix_build_wasm.bzl: expected no failure-masking '|| true' patterns; use conditional diagnostics instead",
  );
});

test("every direct artifact action threads canonical development overrides through argv", async () => {
  const shell = await read("viberoots/build-tools/lang/nix_shell.bzl");
  const runner = await read("viberoots/build-tools/lang/nix_action_runner.bzl");
  assertContains(
    shell,
    'read_config("viberoots", "dev_overrides", "")',
    "canonical Buck config transport must be read by the shared action bootstrap",
  );
  assertContains(
    shell,
    'if [ -e \\"$VBR_ARTIFACT_TOOLS_MARKER\\" ] || [ -L \\"$VBR_ARTIFACT_TOOLS_MARKER\\" ]',
    "repeated action-input materialization must preserve an existing read-only tool marker",
  );
  assertContains(
    shell,
    "declared artifact tool marker authority changed during the action",
    "repeated marker materialization must reject an authority change",
  );
  assertContains(
    runner,
    "nix_declared_action_inputs_manifest_cmd()",
    "the selected-build runner must independently declare its action inputs",
  );
  for (const file of [
    "viberoots/build-tools/lang/nix_action_runner.bzl",
    "viberoots/build-tools/cpp/private/nix_build.bzl",
    "viberoots/build-tools/node/defs_nix.bzl",
    "viberoots/build-tools/node/defs_service.bzl",
    "viberoots/build-tools/node/defs_vercel.bzl",
    "viberoots/build-tools/node/private/nix_test.bzl",
  ]) {
    const source = await read(file);
    assertContains(source, "--buck-action-inputs", `${file}: declared input manifest argv`);
    assertContains(
      source,
      "nix_declared_action_transport_args()",
      `${file}: canonical Buck selector argv transport`,
    );
    assertContains(source, "$VBR_DEV_OVERRIDE_ARG", `${file}: development override argv transport`);
  }
  for (const file of [
    "viberoots/build-tools/go/private/nix_build.bzl",
    "viberoots/build-tools/go/private/nix_build_carchive.bzl",
    "viberoots/build-tools/go/private/nix_build_wasm.bzl",
    "viberoots/build-tools/go/private/nix_test.bzl",
    "viberoots/build-tools/python/private/nix_build.bzl",
    "viberoots/build-tools/python/private/nix_test.bzl",
    "viberoots/build-tools/rust/private/nix_build.bzl",
  ]) {
    assertContains(
      await read(file),
      "nix_action_build_selected_out_path_cmd(",
      `${file}: language runner must reuse the common canonical argv transport`,
    );
  }
});

test("workspace setup establishes canonical tools before direct action path discovery", async () => {
  const runner = await read("viberoots/build-tools/lang/nix_action_runner.bzl");
  const setup =
    runner.match(/def nix_action_workspace_setup_from_args\([\s\S]*?(?=\n\ndef )/)?.[0] || "";
  assert.ok(
    setup.indexOf("nix_artifact_tool_authority_shell()") < setup.indexOf('dirname \\"$0\\"'),
    "workspace setup must establish canonical PATH before dirname",
  );
  assert.ok(
    setup.indexOf("nix_artifact_tool_authority_shell()") < setup.indexOf('git -C \\"$FLK_DIR\\"'),
    "workspace setup must establish canonical PATH before git",
  );
  for (const file of [
    "viberoots/build-tools/cpp/private/nix_build.bzl",
    "viberoots/build-tools/go/private/nix_build_carchive.bzl",
  ]) {
    const source = await read(file);
    assert.ok(
      source.indexOf("nix_action_workspace_setup_from_args()") < source.indexOf("nix_cmd_prefix("),
      `${file}: workspace setup must run through its own canonical tool bootstrap`,
    );
  }

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-action-hostile-path-"));
  try {
    const hostileBin = path.join(tmp, "hostile-bin");
    const sentinel = path.join(tmp, "host-tool-used");
    await fsp.mkdir(hostileBin);
    for (const tool of ["dirname", "git"]) {
      const executable = path.join(hostileBin, tool);
      await fsp.writeFile(executable, `#!/bin/sh\n: > ${JSON.stringify(sentinel)}\nexit 97\n`);
      await fsp.chmod(executable, 0o755);
    }
    const toolsRoot = canonicalArtifactToolsRoot(process.cwd());
    const result = spawnSync(
      path.join(toolsRoot, "bin", "bash"),
      [
        "-c",
        'export PATH="$1/bin"; dirname "$2/out"; git -C "$2" rev-parse --show-toplevel',
        "artifact-action-authority",
        toolsRoot,
        process.cwd(),
      ],
      { encoding: "utf8", env: { PATH: hostileBin } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fsp.stat(sentinel).catch(() => null), null, "host tools must not execute");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
