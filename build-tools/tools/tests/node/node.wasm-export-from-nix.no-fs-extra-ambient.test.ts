#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { copyWasmArtifact } from "../../wasm/export-wasm-from-nix";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { runInTemp } from "../lib/test-helpers";

test("export-wasm-from-nix copies artifacts without ambient fs-extra", async () => {
  await runInTemp("node-wasm-export-no-fs-extra", async (tmp) => {
    const buildOut = path.join(tmp, "build-out");
    const out = path.join(tmp, "buck-out", "tmp", "top.wasm");
    const expected = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
    await fsp.mkdir(path.join(buildOut, "lib"), { recursive: true });
    await fsp.writeFile(path.join(buildOut, "lib", "top.wasm"), expected);

    await copyWasmArtifact(buildOut, "lib", "", [".wasm"], out);

    assert.deepEqual(await fsp.readFile(out), expected);
  });
});

test("export-wasm-from-nix delegates language selection to the canonical selected build", async () => {
  const source = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/wasm/export-wasm-from-nix.ts"),
    "utf8",
  );
  assert.match(source, /buildSelectedOutPath\(repoRoot, target, "auto"/);
  assert.doesNotMatch(source, /PLANNER_ONLY_CPP|VIBEROOTS_ROOT|VIBEROOTS_SOURCE_ROOT/);
});

test("scaffold wasm exports use the canonical declared Buck action adapter", async () => {
  const source = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/wasm/defs.bzl"),
    "utf8",
  );
  assert.match(source, /nix_action_build_selected_out_path_cmd/);
  assert.match(source, /nix_artifact_action_inputs\(ctx\)/);
  assert.match(source, /expected exactly one artifact/);
  assert.doesNotMatch(source, /zx-wrapper|WASM_TARGET|WASM_DIR|process\.env/);
});
