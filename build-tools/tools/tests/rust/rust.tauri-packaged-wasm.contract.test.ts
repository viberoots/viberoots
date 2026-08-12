#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const read = (relative: string) => fs.readFile(path.join(sourceRoot, relative), "utf8");

test("Tauri behavior is observed from the digest-bound WASM inside the packaged app", async () => {
  const [template, observer] = await Promise.all([
    read("build-tools/tools/nix/templates/rust-tauri.nix"),
    read("build-tools/tools/nix/templates/rust-behavior-observer.nix"),
  ]);
  assert.match(
    template,
    /packaged_frontend="\$packaged_app\/Contents\/Resources\/viberoots-frontend"/,
  );
  assert.match(template, /cp "\$frontend_wasm" "\$packaged_frontend\/frontend\.wasm"/);
  assert.match(template, /frontendWasm:\{path:\$frontend_wasm,digest:\$frontend_wasm_digest\}/);
  assert.match(observer, /\.frontendWasm\.path/);
  assert.match(observer, /Contents\/Resources\/viberoots-frontend\/frontend\.wasm/);
  assert.match(observer, /test "\$observed_digest" = "\$expected_digest"/);
  assert.doesNotMatch(observer, /\$\{observeWasm tauri\.frontend\}/);
});
