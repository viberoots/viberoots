#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node wasm source resolver contract is wired into stage and inline macros", async () => {
  await runInTemp("node-wasm-source-resolution-contract-cmd", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "web");
    const viberootsTargets = path.join(tmp, "TARGETS");
    const existingViberootsTargets = await fsp.readFile(viberootsTargets, "utf8");
    await fsp.writeFile(path.join(tmp, "bootstrap"), "#!/usr/bin/env bash\n");
    await fsp.writeFile(
      viberootsTargets,
      [
        'load("@prelude//:rules.bzl", "export_file")',
        'export_file(name = "bootstrap", src = "bootstrap", visibility = ["PUBLIC"])',
        existingViberootsTargets,
      ].join("\n"),
    );
    await fsp.mkdir(path.join(appDir, "assets"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(appDir, "index.html"), "<html></html>\n", "utf8");
    await fsp.writeFile(path.join(appDir, "assets", "sample.wasm"), "sample", "utf8");
    await fsp.writeFile(path.join(appDir, "assets", "module"), "module", "utf8");
    await fsp.writeFile(path.join(appDir, "assets", "raw.txt"), "raw\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "export_file")',
        'load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module")',
        "",
        'export_file(name = "index", src = "index.html")',
        'export_file(name = "raw_asset", src = "assets/raw.txt")',
        "",
        "node_asset_stage(",
        '  name = "staged",',
        '  app = ":index",',
        '  assets = [{"src": "assets/sample.wasm", "artifact_name": "named.wasm", "dest": "wasm/sample.wasm"}, {"src": "assets/module", "kind": "wasm", "dest": "runtime"}, {"src": ":raw_asset", "source_path": "projects/apps/web/assets/raw.txt", "kind": "file", "dest": "raw.txt"}, {"src": "@viberoots//:bootstrap", "kind": "file", "dest": "bootstrap"}],',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "node_wasm_inline_module(",
        '  name = "inline_mod",',
        '  src = "assets/sample.wasm",',
        '  artifact_glob = "*.wasm",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const staged = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:staged`;
    assert.equal(staged.exitCode, 0, String(staged.stderr || ""));
    const stagedCmd = String(staged.stdout || "");
    assert.match(stagedCmd, /resolve_node_wasm_artifact/);
    assert.match(stagedCmd, /ASSET_NAME='named\.wasm'/);
    assert.match(stagedCmd, /ambiguous wasm artifacts/);
    assert.match(stagedCmd, /resolve_node_wasm_surface_file/);
    assert.match(stagedCmd, /typed wasm module surface escaped its artifact root/);
    assert.match(stagedCmd, /0061736d/);
    assert.match(stagedCmd, /rejected metadata\/manifest output/);
    assert.match(stagedCmd, /ASSET_RAW='@viberoots\/\/:bootstrap'/);
    assert.doesNotMatch(stagedCmd, /ASSET_HINT='@viberoots\/\/:bootstrap'/);
    assert.match(stagedCmd, /ASSET_RAW=':raw_asset'/);
    assert.match(stagedCmd, /raw asset is not a file/);
    assert.match(stagedCmd, /ASSET_RAW='assets\/module'/);

    const inline = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:inline_mod`;
    assert.equal(inline.exitCode, 0, String(inline.stderr || ""));
    const inlineCmd = String(inline.stdout || "");
    assert.match(inlineCmd, /resolve_node_wasm_artifact/);
    assert.match(inlineCmd, /SRC_GLOB='\*\.wasm'/);
    assert.match(inlineCmd, /artifact_glob/);
    assert.match(inlineCmd, /resolve_node_wasm_surface_file/);
    assert.match(inlineCmd, /0061736d/);
  });
});

test("node asset metadata rejects escaping paths, unsupported cells, and invalid kinds", async () => {
  await runInTemp("node-asset-metadata-negatives", async (tmp, $) => {
    for (const [name, asset, expected] of [
      ["escape", '{"src": "../secret", "dest": "secret"}', /source must stay inside/],
      ["cell", '{"src": "@other//:file", "dest": "file"}', /unsupported cell label/],
      ["kind", '{"src": "asset.txt", "dest": "asset.txt", "kind": "archive"}', /kind must be/],
      [
        "ambiguous",
        '{"src": "asset", "dest": "runtime"}',
        /extensionless assets require explicit kind/,
      ],
      [
        "output_escape",
        '{"src": ":generated", "dest": "asset.js", "kind": "file", "output_path": "../asset.js"}',
        /output_path must stay inside/,
      ],
      [
        "output_missing",
        '{"src": ":generated", "dest": "asset.js", "kind": "file"}',
        /require source_path or output_path/,
      ],
      [
        "output_substitution",
        '{"src": ":generated", "dest": "asset.js", "kind": "file", "source_path": "asset.js", "output_path": "asset.js"}',
        /cannot set both source_path and output_path/,
      ],
    ] as const) {
      const packageDir = path.join(tmp, "projects", "apps", name);
      await fsp.mkdir(packageDir, { recursive: true });
      await fsp.writeFile(path.join(packageDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
      await fsp.writeFile(path.join(packageDir, "index.html"), "<html></html>\n");
      await fsp.writeFile(path.join(packageDir, "asset.txt"), "raw\n");
      await fsp.writeFile(
        path.join(packageDir, "TARGETS"),
        [
          'load("@prelude//:rules.bzl", "export_file")',
          'load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage")',
          'export_file(name = "index", src = "index.html")',
          "node_asset_stage(",
          '  name = "staged",',
          '  app = ":index",',
          `  assets = [${asset}],`,
          `  labels = ["lockfile:projects/apps/${name}/pnpm-lock.yaml#projects/apps/${name}"],`,
          ")",
        ].join("\n"),
      );
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 cquery --target-platforms //:no_cgo //projects/apps/${name}:staged`;
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr || ""), expected);
    }
  });
});
