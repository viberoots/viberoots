#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  applyTauriScaffoldAnswers,
  tauriBundleIdentifier,
} from "../../scaffolding/scaf/commands/tauri-validation";

const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const read = (relative: string) => fsp.readFile(path.join(sourceRoot, relative), "utf8");

test("Tauri scaffold has managed locks and no hidden frontend command hook", async () => {
  const root = "build-tools/tools/scaffolding/templates/rust/tauri-app";
  const [targets, cargo, cargoLock, config, frontend, icon, packageJSON, pnpmLock, viteConfig] =
    await Promise.all([
      read(`${root}/TARGETS.jinja`),
      read(`${root}/Cargo.toml.jinja`),
      read(`${root}/Cargo.lock.jinja`),
      read(`${root}/tauri.conf.json.jinja`),
      read(`${root}/frontend/src/main.js.jinja`),
      fsp.readFile(path.join(sourceRoot, root, "icons/icon.png")),
      read(`${root}/package.json.jinja`),
      read(`${root}/pnpm-lock.yaml.jinja`),
      read(`${root}/vite.config.mjs.jinja`),
    ]);
  assert.match(targets, /node_asset_stage\(/);
  assert.match(targets, /frontend_dist = ":frontend"/);
  assert.match(targets, /rust_test\(/);
  assert.match(targets, /name = "\{\{ name \}\}-test"/);
  assert.match(targets, /srcs = \["src\/lib\.rs"\]/);
  assert.match(targets, /srcs = \["build\.rs", "src\/lib\.rs", "src\/main\.rs"\]/);
  assert.match(targets, /default_features = False/);
  assert.match(targets, /resources = \[\{"src": "help\.txt", "dest": "help\/help\.txt"\}\]/);
  assert.match(
    cargo,
    /\[\[bin\]\][\s\S]*test = false[\s\S]*bench = false[\s\S]*required-features = \["desktop"\]/,
  );
  assert.match(cargo, /\[features\]\ndefault = \["desktop"\]\ndesktop = \[\]/);
  assert.match(cargo, /tauri = \{ version = "=2\.7\.0"/);
  assert.match(cargoLock, /name = "\{\{ name \}\}"\nversion = "0\.1\.0"/);
  assert.doesNotMatch(cargoLock, /name = "obsolete_tauri_lock"/);
  assert.match(cargoLock, /name = "tauri"\nversion = "2\.7\.0"/);
  const tauriFamily = [
    "tauri",
    "tauri-build",
    "tauri-codegen",
    "tauri-macros",
    "tauri-runtime",
    "tauri-runtime-wry",
    "tauri-utils",
    "wry",
  ];
  const lockedTauriFamily = [
    ...cargoLock.matchAll(/^\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/gm),
  ]
    .filter((match) => tauriFamily.includes(match[1] || ""))
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(lockedTauriFamily, [
    ["tauri", "2.7.0"],
    ["tauri-build", "2.3.1"],
    ["tauri-codegen", "2.3.1"],
    ["tauri-macros", "2.3.2"],
    ["tauri-runtime", "2.7.1"],
    ["tauri-runtime-wry", "2.7.2"],
    ["tauri-utils", "2.6.0"],
    ["wry", "0.52.1"],
  ]);
  assert.ok(cargoLock.split("\n").length > 4_000);
  assert.doesNotMatch(config, /beforeBuildCommand|beforeDevCommand/);
  assert.match(config, /"identifier": "\{\{ tauri_identifier \}\}"/);
  assert.match(config, /"withGlobalTauri": false/);
  assert.match(frontend, /@tauri-apps\/api\/window/);
  assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(icon.readUInt32BE(16), 32);
  assert.equal(icon.readUInt32BE(20), 32);
  assert.equal(icon[25], 6);
  assert.match(packageJSON, /"vite": "5\.4\.10"/);
  assert.match(packageJSON, /"@tauri-apps\/api": "2\.7\.0"/);
  assert.match(pnpmLock, /lockfileVersion: "9\.0"/);
  assert.match(pnpmLock, /"@tauri-apps\/api":\n\s+specifier: 2\.7\.0\n\s+version: 2\.7\.0/);
  assert.match(pnpmLock, /vite:\n\s+specifier: 5\.4\.10\n\s+version: 5\.4\.10/);
  assert.match(viteConfig, /root: "frontend"/);
  assert.doesNotMatch(viteConfig, /process\.env|command|spawn|exec/);
});

test("Tauri scaffold owns one valid reverse-DNS bundle identifier", () => {
  assert.equal(tauriBundleIdentifier("Desktop_App"), "dev.viberoots.desktop-app");
  assert.equal(tauriBundleIdentifier(" Desktop.App "), "dev.viberoots.desktop-app");
  assert.throws(() => tauriBundleIdentifier("___"), /ASCII letter or digit/);
  assert.throws(
    () => tauriBundleIdentifier("a".repeat(64)),
    /invalid or ambiguous reverse-DNS segment/,
  );

  const answers: Record<string, any> = { name: "tauri_smoke_app" };
  applyTauriScaffoldAnswers("rust", "tauri-app", answers);
  assert.equal(answers.tauri_identifier, "dev.viberoots.tauri-smoke-app");
  const unrelated: Record<string, any> = { name: "tauri_smoke_app" };
  applyTauriScaffoldAnswers("rust", "cli", unrelated);
  assert.equal(unrelated.tauri_identifier, undefined);
});
