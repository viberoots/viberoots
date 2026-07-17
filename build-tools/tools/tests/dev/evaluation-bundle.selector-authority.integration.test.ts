#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { materializeEvaluationBundle } from "../../dev/evaluation-bundle";
import { resolveToolPathSync } from "../../lib/tool-paths";

test("pure flake evaluation reads immutable selection with hostile selectors unset", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-selector-"));
  await fsp.writeFile(
    path.join(root, "flake.nix"),
    `{ outputs = _: let
      bundle = builtins.toPath (builtins.dirOf (builtins.toString ./.));
      selection = builtins.fromJSON (builtins.readFile (bundle + "/selection.json"));
    in { lib.selected = selection.target + ":" + builtins.toString selection.onlyCpp + ":" + selection.wasmBackend; }; }
`,
  );
  const bundle = await materializeEvaluationBundle({
    stagedSource: root,
    attr: "lib.selected",
    classification: "local-development",
    requireGraph: false,
    target: "//projects/apps/example:app",
    selectorEnv: { PLANNER_ONLY_CPP: "1", WEB_WASM_BACKEND: "wasi_single" },
  });
  try {
    const result = await $({
      cwd: root,
      env: {
        ...process.env,
        BUCK_GRAPH_JSON: "/host/poison.json",
        BUCK_TARGET: "//host:poison",
        NIX_GO_DEV_OVERRIDE_JSON: '{"host":"poison"}',
        ROOT_GOMOD2NIX_TOML: "/host/poison.toml",
        WORKSPACE_ROOT: "/host/poison",
      },
      stdio: "pipe",
    })`${resolveToolPathSync("nix")} eval --raw --no-write-lock-file --accept-flake-config ${bundle.flakeRef}`;
    assert.equal(String(result.stdout).trim(), "//projects/apps/example:app:1:wasi_single");
    assert.doesNotMatch(bundle.flakeRef, /\/source(?:\/|#)/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
